// Synthetic owner-authorized fan-out ledger. Not an independent delivery proof.
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {open,link,unlink,lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {canonical,digest} from './application.mjs';
import {exact,edValid} from './lifecycle-v3.mjs';
import {acquireVaultLock} from './windows-vault-lock.mjs';
import {verifySourceNotice} from './source-notice.mjs';
import {readBoundedRegularFile} from './bounded-input.mjs';
import {createPrivateDirectory} from './private-directory.mjs';

export const SOURCE_NOTICE_BATCH_VERSION='BAARNE_SYNTHETIC_SOURCE_NOTICE_BATCH_V1';
export const SOURCE_NOTICE_OUTBOX_VERSION='BAARNE_SYNTHETIC_SOURCE_NOTICE_OUTBOX_V1';
export const SOURCE_NOTICE_BATCH_LIMIT=16;
export const SOURCE_NOTICE_BATCH_ATTEMPT_LIMIT=16;
const ROW_LIMIT=1+SOURCE_NOTICE_BATCH_LIMIT*SOURCE_NOTICE_BATCH_ATTEMPT_LIMIT*2;
const ROW_BYTES_LIMIT=256*1024;
const batchFile=n=>'batch-'+String(n).padStart(4,'0')+'.json';
const metadataFor=(ownerKey,batchId)=>({version:SOURCE_NOTICE_OUTBOX_VERSION,ownerKey,batchId});
async function readOutboxText(path,maxBytes,fileError,sizeError){
  const bytes=await readBoundedRegularFile(path,maxBytes,fileError,sizeError);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error(fileError);}
}
export const sourceNoticeBatchMessage=body=>SOURCE_NOTICE_BATCH_VERSION+'\nOWNER_AUTHORIZED_DESTINATION_BATCH\n'+canonical(body);
export const sourceNoticeOutboxEventMessage=body=>SOURCE_NOTICE_OUTBOX_VERSION+'\nOWNER_OUTBOX_EVENT\n'+canonical(body);
const idFor=destination=>digest(destination);

function safeOwnerKey(value){if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))throw Error('INVALID_OWNER_KEY');}
function validBatchBody(body,ownerKey){
  exact(body,['version','sourceHead','actorId','action','createdAt','entries']);
  if(body.version!==SOURCE_NOTICE_BATCH_VERSION||!Number.isSafeInteger(body.createdAt)||body.createdAt<0||!/^synthetic:user-[0-9]{2}$/.test(body.actorId)||!['REVOKE','DELETE'].includes(body.action)||!Array.isArray(body.entries)||body.entries.length<1||body.entries.length>SOURCE_NOTICE_BATCH_LIMIT)throw Error('INVALID_NOTICE_BATCH');
  let prior='';const destinations=new Set();
  for(const entry of body.entries){
    exact(entry,['destination','notice']);const key=canonical(entry.destination);
    if(destinations.has(key)||key<=prior)throw Error('DUPLICATE_OR_UNSORTED_DESTINATION');prior=key;destinations.add(key);
    const notice=verifySourceNotice(entry.notice,ownerKey,entry.destination,body.actorId);
    if(canonical(notice.sourceHead)!==canonical(body.sourceHead)||notice.action!==body.action||notice.now!==body.createdAt)throw Error('NOTICE_BATCH_ENTRY_MISMATCH');
  }
}
export function verifySourceNoticeBatch(batch,ownerKey){
  safeOwnerKey(ownerKey);exact(batch,['body','signature']);try{validBatchBody(batch.body,ownerKey);}catch{throw Error('INVALID_NOTICE_BATCH');}
  if(Buffer.byteLength(canonical(batch))>128*1024||!edValid(ownerKey,sourceNoticeBatchMessage(batch.body),batch.signature))throw Error('INVALID_NOTICE_BATCH_SIGNATURE');
  return structuredClone(batch.body);
}
export async function createSourceNoticeBatch(entries,createdAt,sign){
  if(!Array.isArray(entries)||entries.length<1||entries.length>SOURCE_NOTICE_BATCH_LIMIT||!Number.isSafeInteger(createdAt)||createdAt<0||typeof sign!=='function')throw Error('INVALID_NOTICE_BATCH_REQUEST');
  const first=entries[0]?.notice?.body;if(!first)throw Error('INVALID_NOTICE_BATCH_REQUEST');
  const ownerKey=first.sourceHead?.ownerKey,actorId=first.actorId,action=first.action,sourceHead=first.sourceHead;
  const normalized=entries.map(entry=>({destination:structuredClone(entry.destination),notice:structuredClone(entry.notice)})).sort((a,b)=>{const left=canonical(a.destination),right=canonical(b.destination);return left<right?-1:left>right?1:0;});
  const body={version:SOURCE_NOTICE_BATCH_VERSION,sourceHead:structuredClone(sourceHead),actorId,action,createdAt,entries:normalized};
  const batch={body,signature:await sign(sourceNoticeBatchMessage(body))};verifySourceNoticeBatch(batch,ownerKey);return batch;
}

function validateTrusted(trusted){exact(trusted,['revision','head','batchId','ownerKey']);safeOwnerKey(trusted.ownerKey);if(!Number.isSafeInteger(trusted.revision)||trusted.revision<0||trusted.revision>=ROW_LIMIT||[trusted.head,trusted.batchId].some(v=>typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v)))throw Error('INVALID_OUTBOX_CHECKPOINT');}
function newState(batch){return {batch:structuredClone(batch),targets:batch.body.entries.map(entry=>({targetId:idFor(entry.destination),status:'PENDING',attempts:0,resultHash:null,updatedAt:batch.body.createdAt}))};}
function effectiveStatus(target){return target.status==='IN_FLIGHT'?'UNKNOWN':target.status;}
function applyEvent(state,event,ownerKey){
  exact(event,['body','signature']);const b=event.body;exact(b,['version','batchId','targetId','kind','attempt','status','resultHash','at','nonce']);
  if(b.version!==SOURCE_NOTICE_OUTBOX_VERSION||b.batchId!==digest(state.batch)||!Number.isSafeInteger(b.at)||b.at<0||typeof b.nonce!=='string'||!/^[0-9a-f]{64}$/.test(b.nonce)||typeof b.targetId!=='string'||!/^[0-9a-f]{64}$/.test(b.targetId)||!edValid(ownerKey,sourceNoticeOutboxEventMessage(b),event.signature))throw Error('INVALID_OUTBOX_EVENT');
  const target=state.targets.find(x=>x.targetId===b.targetId);if(!target)throw Error('UNKNOWN_OUTBOX_TARGET');const status=effectiveStatus(target);
  if(b.kind==='ATTEMPT'){
    if(!['PENDING','UNKNOWN','UNAVAILABLE','IN_PROGRESS'].includes(status)||b.status!==null||b.resultHash!==null||b.attempt!==target.attempts+1||b.attempt>SOURCE_NOTICE_BATCH_ATTEMPT_LIMIT||b.at<target.updatedAt)throw Error('INVALID_OUTBOX_ATTEMPT');
    target.status='IN_FLIGHT';target.attempts=b.attempt;target.resultHash=null;target.updatedAt=b.at;
  }else if(b.kind==='OUTCOME'){
    if(target.status!=='IN_FLIGHT'||b.attempt!==target.attempts||!['APPLIED','NOT_APPLIED','IN_PROGRESS','UNKNOWN','UNAVAILABLE','REJECTED'].includes(b.status)||typeof b.resultHash!=='string'||!/^[0-9a-f]{64}$/.test(b.resultHash)||b.at<target.updatedAt)throw Error('INVALID_OUTBOX_OUTCOME');
    target.status=b.status;target.resultHash=b.resultHash;target.updatedAt=b.at;
  }else throw Error('INVALID_OUTBOX_EVENT_KIND');
  return state;
}
function seal(value,key,previous,revision){const iv=randomBytes(12),header={version:SOURCE_NOTICE_OUTBOX_VERSION,previous,revision,iv:iv.toString('hex')},cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(canonical(header)));const data=Buffer.concat([cipher.update(canonical(value),'utf8'),cipher.final()]);return {...header,tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')};}
function unseal(row,key){exact(row,['version','previous','revision','iv','tag','data']);if(row.version!==SOURCE_NOTICE_OUTBOX_VERSION||!Number.isSafeInteger(row.revision)||row.revision<0||typeof row.previous!=='string'||!/^[0-9a-f]{64}$/.test(row.previous)||typeof row.iv!=='string'||!/^[0-9a-f]{24}$/.test(row.iv)||typeof row.tag!=='string'||!/^[0-9a-f]{32}$/.test(row.tag)||typeof row.data!=='string'||row.data.length>ROW_BYTES_LIMIT*2||!/^(?:[0-9a-f]{2})+$/.test(row.data))throw Error('INVALID_OUTBOX_ROW');const {tag,data,...header}=row,cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(row.iv,'hex'));cipher.setAAD(Buffer.from(canonical(header)));cipher.setAuthTag(Buffer.from(tag,'hex'));let clear;try{clear=Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]);const raw=clear.toString('utf8'),value=JSON.parse(raw);if(canonical(value)!==raw)throw Error('NONCANONICAL_OUTBOX_ROW');return value;}catch{throw Error('INVALID_OUTBOX_AUTHENTICATION');}finally{clear?.fill(0);}}
async function publish(directory,row,hook=async()=>{}){const raw=canonical(row);if(Buffer.byteLength(raw)>ROW_BYTES_LIMIT)throw Error('OUTBOX_ROW_QUOTA');const temporary=join(directory,'pending-'+randomBytes(16).toString('hex')),file=await open(temporary,'wx',0o600);try{await file.writeFile(raw,'utf8');await file.sync();}finally{await file.close();}await hook('beforePublish');try{await link(temporary,join(directory,batchFile(row.revision)));}finally{await unlink(temporary);}if(process.platform!=='win32'){const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}}await hook('afterPublish');}
async function writeMetadata(directory,metadata){const file=await open(join(directory,'metadata.json'),'wx',0o600);try{await file.writeFile(canonical(metadata),'utf8');await file.sync();}finally{await file.close();}}
function view(state,checkpoint,recovered){return {batchId:checkpoint.batchId,checkpoint:structuredClone(checkpoint),recoveredUnpinnedAppend:recovered,targets:state.targets.map(t=>({targetId:t.targetId,status:effectiveStatus(t),attempts:t.attempts,resultHash:t.resultHash,updatedAt:t.updatedAt}))};}

export class SourceNoticeOutbox{
  #directory;#key;#ownerKey;#state;#head;#revision;#lock;#hook;#busy=false;#operationBusy=false;#activeTargetId=null;#faulted=false;#idle=Promise.resolve();#closing;
  constructor(directory,key,ownerKey,state,head,revision,lock,hook=async()=>{},faulted=false){this.#directory=directory;this.#key=Buffer.from(key);this.#ownerKey=ownerKey;this.#state=state;this.#head=head;this.#revision=revision;this.#lock=lock;this.#hook=hook;this.#faulted=faulted;}
  static async create(directory,key,batch,ownerKey,{hook=async()=>{}}={}){
    safeOwnerKey(ownerKey);if(!Buffer.isBuffer(key)||key.length!==32)throw Error('INVALID_OUTBOX_KEY');verifySourceNoticeBatch(batch,ownerKey);await createPrivateDirectory(directory);const metadata=metadataFor(ownerKey,digest(batch)),lock=await acquireVaultLock(join(directory,'writer.lock'));
    try{await writeMetadata(directory,metadata);const state=newState(batch),row=seal({batch},key,digest(metadata),0);await publish(directory,row,hook);const store=new SourceNoticeOutbox(directory,key,ownerKey,state,digest(row),0,lock,hook);return {store,checkpoint:store.checkpoint()};}catch(error){await lock.close();throw error;}
  }
  static async load(directory,key,trusted,{hook=async()=>{}}={}){
    validateTrusted(trusted);if(!Buffer.isBuffer(key)||key.length!==32)throw Error('INVALID_OUTBOX_KEY');const root=await lstat(directory);if(!root.isDirectory()||root.isSymbolicLink())throw Error('INVALID_OUTBOX_DIRECTORY');
    const metadataPath=join(directory,'metadata.json'),metadataRaw=await readOutboxText(metadataPath,4096,'INVALID_OUTBOX_METADATA','INVALID_OUTBOX_METADATA'),metadata=JSON.parse(metadataRaw);if(canonical(metadata)!==metadataRaw||canonical(metadata)!==canonical(metadataFor(trusted.ownerKey,trusted.batchId)))throw Error('WRONG_OUTBOX_SCOPE');
    const lock=await acquireVaultLock(join(directory,'writer.lock'));try{
      const names=await readdir(directory),rows=[];let pending=0;if(names.length>ROW_LIMIT+34)throw Error('OUTBOX_FILE_QUOTA');
      for(const name of names){const stat=await lstat(join(directory,name));if(!stat.isFile()||stat.isSymbolicLink())throw Error('INVALID_OUTBOX_FILE');if(name==='metadata.json'||name==='writer.lock')continue;if(/^batch-[0-9]{4}\.json$/.test(name)){rows.push(Number(name.slice(6,10)));continue;}if(/^pending-[0-9a-f]{32}$/.test(name)&&stat.size<=ROW_BYTES_LIMIT&&++pending<=32)continue;throw Error('UNEXPECTED_OUTBOX_FILE');}
      rows.sort((a,b)=>a-b);if(rows.some((n,i)=>n!==i)||rows.length<trusted.revision+1||rows.length>trusted.revision+4||rows.length>ROW_LIMIT)throw Error('OUTBOX_HISTORY_LENGTH');
      let head=digest(metadata),state=null;const unpinnedEvents=[];for(let revision=0;revision<rows.length;revision++){
        const path=join(directory,batchFile(revision)),raw=await readOutboxText(path,ROW_BYTES_LIMIT,'INVALID_OUTBOX_FILE','OUTBOX_ROW_QUOTA'),row=JSON.parse(raw);if(canonical(row)!==raw||row.revision!==revision||row.previous!==head)throw Error('BROKEN_OUTBOX_CHAIN');const payload=unseal(row,key);if(revision===0){exact(payload,['batch']);verifySourceNoticeBatch(payload.batch,trusted.ownerKey);if(digest(payload.batch)!==trusted.batchId)throw Error('OUTBOX_BATCH_MISMATCH');state=newState(payload.batch);}else{exact(payload,['event']);if(revision>trusted.revision)unpinnedEvents.push(payload.event);state=applyEvent(state,payload.event,trusted.ownerKey);}head=digest(row);
        if(revision===trusted.revision&&(head!==trusted.head||digest(state.batch)!==trusted.batchId))throw Error('UNTRUSTED_OUTBOX_HEAD');
      }
      if(unpinnedEvents.length>2)throw Error('OUTBOX_RECOVERY_LIMIT');
      if(unpinnedEvents.length===2){const [attempt,outcome]=unpinnedEvents;if(attempt.body.kind!=='ATTEMPT'||outcome.body.kind!=='OUTCOME'||attempt.body.targetId!==outcome.body.targetId||attempt.body.attempt!==outcome.body.attempt)throw Error('OUTBOX_RECOVERY_LIMIT');}
      const recovered=unpinnedEvents.length>0;lock.assertOwned();const store=new SourceNoticeOutbox(directory,key,trusted.ownerKey,state,head,rows.length-1,lock,hook);return {store,checkpoint:store.checkpoint(),recoveredUnpinnedAppend:recovered};
    }catch(error){await lock.close();throw error;}
  }
  checkpoint(){if(this.#faulted)throw Error('OUTBOX_REOPEN_REQUIRED');this.#lock.assertOwned();return {revision:this.#revision,head:this.#head,batchId:digest(this.#state.batch),ownerKey:this.#ownerKey};}
  status(){const result=view(this.#state,this.checkpoint(),false);if(this.#activeTargetId)for(const target of result.targets)if(target.targetId===this.#activeTargetId)target.status='IN_FLIGHT';return result;}
  entry(targetId){this.checkpoint();const index=this.#state.targets.findIndex(t=>t.targetId===targetId);if(index<0)throw Error('UNKNOWN_OUTBOX_TARGET');return structuredClone({targetId,...this.#state.targets[index],destination:this.#state.batch.body.entries[index].destination,notice:this.#state.batch.body.entries[index].notice});}
  #eventBody(targetId,kind,attempt,status,resultHash,at){return {version:SOURCE_NOTICE_OUTBOX_VERSION,batchId:digest(this.#state.batch),targetId,kind,attempt,status,resultHash,at,nonce:randomBytes(32).toString('hex')};}
  async #append(event){if(this.#faulted)throw Error('OUTBOX_REOPEN_REQUIRED');this.#lock.assertOwned();if(this.#revision+1>=ROW_LIMIT)throw Error('OUTBOX_HISTORY_QUOTA');const row=seal({event},this.#key,this.#head,this.#revision+1);this.#busy=true;try{await publish(this.#directory,row,this.#hook);this.#lock.assertOwned();this.#state=applyEvent(structuredClone(this.#state),event,this.#ownerKey);this.#head=digest(row);this.#revision=row.revision;}catch(error){this.#faulted=true;throw error;}finally{this.#busy=false;}}
  async deliver(targetId,sign,send,now=Math.floor(Date.now()/1000)){
    if(this.#busy||this.#operationBusy||this.#faulted)throw Error('OUTBOX_BUSY_OR_REOPEN_REQUIRED');if(typeof sign!=='function'||typeof send!=='function'||!Number.isSafeInteger(now)||now<0)throw Error('INVALID_DELIVERY_REQUEST');const target=this.#state.targets.find(t=>t.targetId===targetId);if(!target)throw Error('UNKNOWN_OUTBOX_TARGET');const status=effectiveStatus(target);if(status==='APPLIED'||status==='NOT_APPLIED'||status==='REJECTED')throw Error('TARGET_REQUIRES_NEW_OWNER_BATCH');if(!['PENDING','UNKNOWN','UNAVAILABLE','IN_PROGRESS'].includes(status))throw Error('INVALID_TARGET_STATUS');if(target.attempts>=SOURCE_NOTICE_BATCH_ATTEMPT_LIMIT)throw Error('TARGET_ATTEMPT_QUOTA');
    this.#operationBusy=true;this.#activeTargetId=targetId;let done;this.#idle=new Promise(resolve=>{done=resolve;});
    try{const attempt=target.attempts+1,started=this.#eventBody(targetId,'ATTEMPT',attempt,null,null,now),startEvent={body:started,signature:await sign(sourceNoticeOutboxEventMessage(started))};if(!edValid(this.#ownerKey,sourceNoticeOutboxEventMessage(started),startEvent.signature))throw Error('OUTBOX_OWNER_POSSESSION_REQUIRED');await this.#append(startEvent);
      const entry=this.entry(targetId);let result;try{result=await send(entry);}catch(error){result={status:'UNKNOWN',transportCode:typeof error?.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:'TRANSPORT_ERROR'};}
      try{if(!result||!['APPLIED','NOT_APPLIED','IN_PROGRESS','UNKNOWN','UNAVAILABLE','REJECTED'].includes(result.status)||Buffer.byteLength(canonical(result))>8192)result={status:'UNKNOWN',transportCode:'INVALID_OR_OVERSIZED_RESULT'};}catch{result={status:'UNKNOWN',transportCode:'INVALID_OR_OVERSIZED_RESULT'};}
      const outcomeBody=this.#eventBody(targetId,'OUTCOME',attempt,result.status,digest(result),Math.max(now,Number.isSafeInteger(result.at)?result.at:now)),event={body:outcomeBody,signature:await sign(sourceNoticeOutboxEventMessage(outcomeBody))};if(!edValid(this.#ownerKey,sourceNoticeOutboxEventMessage(outcomeBody),event.signature))throw Error('OUTBOX_OWNER_POSSESSION_REQUIRED');await this.#append(event);return {status:result.status,checkpoint:this.checkpoint(),target:this.#state.targets.find(t=>t.targetId===targetId).targetId};
    }finally{this.#operationBusy=false;this.#activeTargetId=null;done();}
  }
  close(){return this.#closing??=(async()=>{await this.#idle;this.#key.fill(0);await this.#lock.close();})();}
}
