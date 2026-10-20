// Local synthetic service. The root encryption key is supplied in memory.
// Never exports private data to consensus; localhost HTTP is not remote TLS.
import {createServer} from 'node:http';import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {open,link,unlink,lstat,opendir} from 'node:fs/promises';import {join} from 'node:path';
import {canonical,digest} from './application.mjs';import {edValid,exact} from './lifecycle-v3.mjs';
import {createVault,applyVaultCommand,readVault,readVaultOwnerState,sealVault,openVault,VAULT_VERSION,vaultMessage} from './private-vault.mjs';
import {acquireVaultLock} from './windows-vault-lock.mjs';
import {readBoundedRegularFile} from './bounded-input.mjs';
import {createPrivateDirectory} from './private-directory.mjs';
export const SERVICE_VERSION='BAARNE_SYNTHETIC_VAULT_SERVICE_V1';
export const STORE_VERSION='BAARNE_SYNTHETIC_VAULT_RECOVERY_STORE_V2';
export const serviceMessage=challenge=>SERVICE_VERSION+'\nONE_TIME_REQUEST\n'+canonical(challenge);
const fileName=revision=>'snapshot-'+String(revision).padStart(4,'0')+'.json';
async function publish(directory,name,raw,hook=async()=>{}){const temporary=join(directory,'pending-'+randomUUID()),file=await open(temporary,'wx',0o600);try{await file.writeFile(raw);await file.sync();}finally{await file.close();}await hook('beforePublish');try{await link(temporary,join(directory,name));await hook('afterPublish');}finally{await unlink(temporary);}if(process.platform!=='win32'){const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}}}
async function readBounded(path,max){const bytes=await readBoundedRegularFile(path,max,'INVALID_STORE_FILE','INVALID_STORE_FILE');try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('INVALID_STORE_FILE');}}
export class PrivateVaultStore{
  #directory;#state;#key;#pin;#head;#lock;#hook;#receipts;#busy=false;#faulted=false;#idle=Promise.resolve();#closing;
  constructor(directory,state,key,pin,head,lock,receipts=new Map(),hook=async()=>{}){this.#directory=directory;this.#state=state;this.#key=Buffer.from(key);this.#pin=pin;this.#head=head;this.#lock=lock;this.#receipts=receipts;this.#hook=hook;}
  static async create(directory,scope,ownerKey,profile,key){
    const state=createVault(scope,ownerKey,profile),sealed=sealVault(state,key),metadata={version:STORE_VERSION,scope,ownerKey};await createPrivateDirectory(directory);const lock=await acquireVaultLock(join(directory,'writer.lock'));
    try{await publish(directory,'metadata.json',canonical(metadata));const row={previous:digest(metadata),encrypted:sealed.raw,pin:sealed.pin,intent:null};await publish(directory,fileName(0),canonical(row));return new PrivateVaultStore(directory,state,key,sealed.pin,digest(row),lock);}catch(e){await lock.close();throw e;}
  }
  static async load(directory,key,trusted,options={}){return (await PrivateVaultStore.#restore(directory,key,trusted,null,options)).store;}
  static async recover(directory,key,trusted,expected,options={}){if(!expected)throw Error('EXPECTED_SIGNED_COMMAND_REQUIRED');return PrivateVaultStore.#restore(directory,key,trusted,expected,options);}
  static async #restore(directory,key,trusted,expected,{hook=async()=>{}}={}){
    exact(trusted,['revision','pin','head','scope','ownerKey']);if(!Number.isSafeInteger(trusted.revision)||trusted.revision<0||trusted.revision>1000)throw Error('INVALID_TRUSTED_PIN');
    exact(trusted.scope,['mode','network','account']);if(trusted.scope.mode!=='ISOLATED_SYNTHETIC_LAB'||typeof trusted.scope.network!=='string'||!/^baarne:[a-z0-9-]{3,64}$/.test(trusted.scope.network)||typeof trusted.scope.account!=='string'||!/^[0-9a-f]{64}$/.test(trusted.scope.account)||typeof trusted.ownerKey!=='string'||!/^[0-9a-f]{64}$/.test(trusted.ownerKey))throw Error('INVALID_TRUSTED_SCOPE');
    const root=await lstat(directory);if(!root.isDirectory()||root.isSymbolicLink())throw Error('INVALID_STORE_DIRECTORY');
    const metadata=JSON.parse(await readBounded(join(directory,'metadata.json'),4096));if(metadata.version!==STORE_VERSION)throw Error('LEGACY_STORE_REQUIRES_EXPLICIT_MIGRATION');
    if(canonical(metadata)!==canonical({version:STORE_VERSION,scope:trusted.scope,ownerKey:trusted.ownerKey}))throw Error('WRONG_STORE_SCOPE');
    if(expected)commandValid(expected,trusted.scope,trusted.ownerKey);
    const lock=await acquireVaultLock(join(directory,'writer.lock'));
    try{
      let snapshots=0,pending=0,count=0;for await(const entry of await opendir(directory)){
        if(++count>1035||!entry.isFile())throw Error('UNEXPECTED_STORE_ENTRY');
        if(entry.name==='metadata.json'||entry.name==='writer.lock')continue;
        if(/^snapshot-[0-9]{4}\.json$/.test(entry.name)){snapshots++;continue;}
        if(/^pending-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.name)&&(await lstat(join(directory,entry.name))).size<=285000&&++pending<=32)continue;
        throw Error('UNEXPECTED_STORE_ENTRY');
      }
      if(snapshots!==trusted.revision+1&&(!expected||snapshots!==trusted.revision+2))throw Error('STORE_LENGTH_MISMATCH');
      let head=digest(metadata),state,pin;const receipts=new Map();
      for(let revision=0;revision<snapshots;revision++){
        const raw=await readBounded(join(directory,fileName(revision)),285000),row=JSON.parse(raw);exact(row,['previous','encrypted','pin','intent']);if(canonical(row)!==raw||row.previous!==head)throw Error('BROKEN_STORE_CHAIN');
        const next=openVault(row.encrypted,key,{pin:row.pin,scope:trusted.scope,revision,ownerKey:trusted.ownerKey});let record;
        if(revision===0){if(row.intent!==null)throw Error('INVALID_INITIAL_INTENT');}
        else{record=unsealIntent(row.intent,key,{scope:trusted.scope,revision,previous:row.previous});commandValid(record,trusted.scope,trusted.ownerKey);if(canonical(applyVaultCommand(state,record))!==canonical(next))throw Error('SIGNED_TRANSITION_MISMATCH');}
        pin=row.pin;head=digest(row);state=next;
        if(revision===trusted.revision&&(pin!==trusted.pin||head!==trusted.head))throw Error('UNTRUSTED_STORE_HEAD');
        if(revision>trusted.revision&&canonical(record)!==canonical(expected))throw Error('UNEXPECTED_RECOVERY_COMMAND');
        if(record)receipts.set(digest(record),{head:{revision,pin,head,scope:structuredClone(trusted.scope),ownerKey:trusted.ownerKey},proof:structuredClone(row)});
      }
      lock.assertOwned();const store=new PrivateVaultStore(directory,state,key,pin,head,lock,receipts,hook);
      return {store,...(expected?{reconciliation:store.status(expected),pendingFilesIgnored:pending}:{})};
    }catch(e){await lock.close();throw e;}
  }
  publicHead(){return {revision:this.#state.revision,pin:this.#pin,head:this.#head,scope:structuredClone(this.#state.scope),ownerKey:this.#state.ownerKey};}
  static validateArchive(files,key,trusted){exact(trusted,['revision','pin','head','scope','ownerKey']);if(!Number.isSafeInteger(trusted.revision)||trusted.revision<0||trusted.revision>1000||Object.keys(files).length!==trusted.revision+2)throw Error('INVALID_VAULT_ARCHIVE');const rawMeta=files['metadata.json'],metadata=JSON.parse(rawMeta);if(canonical(metadata)!==rawMeta||canonical(metadata)!==canonical({version:STORE_VERSION,scope:trusted.scope,ownerKey:trusted.ownerKey})||trusted.scope.mode!=='ISOLATED_SYNTHETIC_LAB')throw Error('WRONG_VAULT_ARCHIVE');let head=digest(metadata),state,pin;for(let n=0;n<=trusted.revision;n++){const raw=files[fileName(n)];if(typeof raw!=='string'||Buffer.byteLength(raw)>285000)throw Error('INVALID_VAULT_ARCHIVE_FILE');const row=JSON.parse(raw);exact(row,['previous','encrypted','pin','intent']);if(canonical(row)!==raw||row.previous!==head)throw Error('BROKEN_VAULT_ARCHIVE');const next=openVault(row.encrypted,key,{pin:row.pin,scope:trusted.scope,revision:n,ownerKey:trusted.ownerKey});if(n===0){if(row.intent!==null)throw Error('INVALID_INITIAL_INTENT');}else{const record=unsealIntent(row.intent,key,{scope:trusted.scope,revision:n,previous:row.previous});commandValid(record,trusted.scope,trusted.ownerKey);if(canonical(applyVaultCommand(state,record))!==canonical(next))throw Error('VAULT_ARCHIVE_TRANSITION_MISMATCH');}state=next;pin=row.pin;head=digest(row);}if(head!==trusted.head||pin!==trusted.pin)throw Error('VAULT_ARCHIVE_PIN_MISMATCH');}
  requiresReopen(){if(this.#faulted)return true;try{this.#lock.assertOwned();return false;}catch{return true;}}
  actor(request){if(request.kind==='OWNER_STATE'){if(request.record?.body?.purpose!=='OWNER_STATUS')throw Error('OWNER_STATUS_REQUIRED');return this.#state.ownerKey;}if(request.kind==='OWNER_VIEW'){if(request.record?.body?.purpose!=='OWNER_EXPORT')throw Error('OWNER_EXPORT_REQUIRED');return this.#state.ownerKey;}if(['COMMAND','STATUS'].includes(request.kind))return this.#state.ownerKey;if(request.kind!=='READ')throw Error('UNSUPPORTED_REQUEST');const b=request.record?.body;if(b?.purpose==='OWNER_EXPORT')return this.#state.ownerKey;const grant=b?.grantId;if(typeof grant!=='string'||!Object.hasOwn(this.#state.grants,grant))throw Error('ACCESS_DENIED');return this.#state.grants[grant].readerKey;}
  status(record){if(this.#faulted)throw Error('REOPEN_REQUIRED');this.#lock.assertOwned();commandValid(record,this.#state.scope,this.#state.ownerKey);const id=digest(record),receipt=this.#receipts.get(id);return {status:receipt?'APPLIED':this.#busy?'IN_PROGRESS':'NOT_APPLIED',commandId:id,appliedHead:receipt?structuredClone(receipt.head):null,transitionProof:receipt?structuredClone(receipt.proof):null,currentHead:this.publicHead()};}
  async execute(request,now){
    if(this.#faulted)throw Error('REOPEN_REQUIRED');this.#lock.assertOwned();exact(request,['kind','record']);
    if(request.kind==='OWNER_STATE')return {...readVaultOwnerState(this.#state,request.record),head:this.publicHead()};if(request.kind==='OWNER_VIEW'){if(request.record?.body?.purpose!=='OWNER_EXPORT')throw Error('OWNER_EXPORT_REQUIRED');return {profile:readVault(this.#state,request.record,now),head:this.publicHead()};}if(request.kind==='READ')return readVault(this.#state,request.record,now);
    if(request.kind==='STATUS')return this.status(request.record);
    if(request.kind!=='COMMAND'||this.#busy)throw Error('BUSY_OR_INVALID_REQUEST');this.#busy=true;
    let done;this.#idle=new Promise(resolve=>{done=resolve;});
    try{commandValid(request.record,this.#state.scope,this.#state.ownerKey);const id=digest(request.record);if(this.#receipts.has(id))return this.publicHead();
      const next=applyVaultCommand(this.#state,request.record);if(next.revision>1000)throw Error('REVISION_QUOTA');const sealed=sealVault(next,this.#key),row={previous:this.#head,encrypted:sealed.raw,pin:sealed.pin,intent:sealIntent(request.record,this.#key,{scope:this.#state.scope,revision:next.revision,previous:this.#head})};
      try{await publish(this.#directory,fileName(next.revision),canonical(row),async step=>{this.#lock.assertOwned();await this.#hook(step);this.#lock.assertOwned();});this.#lock.assertOwned();}catch(e){this.#faulted=true;throw e;}
      this.#state=next;this.#pin=sealed.pin;this.#head=digest(row);this.#receipts.set(id,{head:this.publicHead(),proof:structuredClone(row)});return this.publicHead();
    }finally{this.#busy=false;done();}
  }
  close(){return this.#closing??=(async()=>{this.#faulted=true;await this.#idle;this.#key.fill(0);await this.#lock.close();})();}
}
function commandValid(record,scope,ownerKey){exact(record,['body','signature']);exact(record.body,['version','scope','revision','action','payload']);if(Buffer.byteLength(canonical(record))>36000||record.body.version!==VAULT_VERSION||canonical(record.body.scope)!==canonical(scope)||!Number.isSafeInteger(record.body.revision)||record.body.revision<1||record.body.revision>1000||!edValid(ownerKey,vaultMessage(record.body),record.signature))throw Error('INVALID_OWNER_COMMAND');}
function sealIntent(record,key,context){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(canonical({version:STORE_VERSION,purpose:'SIGNED_OWNER_COMMAND',...context})));const data=Buffer.concat([cipher.update(canonical(record),'utf8'),cipher.final()]);return {iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')};}
function unsealIntent(value,key,context){exact(value,['iv','tag','data']);if(typeof value.iv!=='string'||!/^[0-9a-f]{24}$/.test(value.iv)||typeof value.tag!=='string'||!/^[0-9a-f]{32}$/.test(value.tag)||typeof value.data!=='string'||value.data.length>72000||!/^([0-9a-f]{2})+$/.test(value.data))throw Error('INVALID_ENCRYPTED_INTENT');const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'hex'));cipher.setAAD(Buffer.from(canonical({version:STORE_VERSION,purpose:'SIGNED_OWNER_COMMAND',...context})));cipher.setAuthTag(Buffer.from(value.tag,'hex'));const clear=Buffer.concat([cipher.update(Buffer.from(value.data,'hex')),cipher.final()]);try{const raw=clear.toString('utf8'),record=JSON.parse(raw);if(canonical(record)!==raw)throw Error('NONCANONICAL_INTENT');return record;}finally{clear.fill(0);}}
export function verifyVaultTransition(state,trusted,record,key,row){
  exact(trusted,['revision','pin','head','scope','ownerKey']);exact(row,['previous','encrypted','pin','intent']);
  if(state.revision!==trusted.revision||state.ownerKey!==trusted.ownerKey||canonical(state.scope)!==canonical(trusted.scope)||row.previous!==trusted.head)throw Error('WRONG_TRANSITION_PREFIX');
  commandValid(record,trusted.scope,trusted.ownerKey);const revision=trusted.revision+1;
  if(canonical(unsealIntent(row.intent,key,{scope:trusted.scope,revision,previous:row.previous}))!==canonical(record))throw Error('WRONG_TRANSITION_COMMAND');
  const next=openVault(row.encrypted,key,{pin:row.pin,scope:trusted.scope,revision,ownerKey:trusted.ownerKey});if(canonical(applyVaultCommand(state,record))!==canonical(next))throw Error('SIGNED_TRANSITION_MISMATCH');
  return {state:next,head:{revision,pin:row.pin,head:digest(row),scope:structuredClone(trusted.scope),ownerKey:trusted.ownerKey}};
}
export async function startVaultService(store,{clock=()=>Math.floor(Date.now()/1000)}={}){
  const serviceId=randomBytes(32).toString('hex'),challenges=new Map();let address;
  const server=createServer(async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});res.end(JSON.stringify(body));};
    try{
      if(req.method!=='POST'||!['/challenge','/request'].includes(req.url)||req.headers.origin||req.headers.host!=='127.0.0.1:'+address.port||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return reply(403,{error:'LOCAL_PROTOCOL_REQUIRED'});
      if(req.headers['content-type']!=='application/json')return reply(415,{error:'JSON_REQUIRED'});
      let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>40000){reply(413,{error:'REQUEST_TOO_LARGE'});req.destroy();return;}chunks.push(chunk);}
      const value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks))),now=clock();if(!Number.isSafeInteger(now)||now<0)throw Error('INVALID_CLOCK');
      for(const [nonce,c] of challenges)if(c.expiresAt<=now)challenges.delete(nonce);
      if(req.url==='/challenge'){
        exact(value,['actorKey','requestHash']);if(typeof value.actorKey!=='string'||!/^[0-9a-f]{64}$/.test(value.actorKey)||typeof value.requestHash!=='string'||!/^[0-9a-f]{64}$/.test(value.requestHash))throw Error('INVALID_CHALLENGE');
        if(challenges.size>=128)return reply(429,{error:'CHALLENGE_QUOTA'});
        const h=store.publicHead(),challenge={version:SERVICE_VERSION,serviceId,nonce:randomBytes(32).toString('hex'),expiresAt:now+15,actorKey:value.actorKey,requestHash:value.requestHash,revision:h.revision,scope:h.scope};challenges.set(challenge.nonce,challenge);return reply(200,{challenge});
      }
      exact(value,['challenge','signature','request']);const c=value.challenge,stored=challenges.get(c?.nonce);
      if(!stored||canonical(stored)!==canonical(c)||c.serviceId!==serviceId||c.expiresAt<=now||c.revision!==store.publicHead().revision||c.requestHash!==digest(value.request)||store.actor(value.request)!==c.actorKey||!edValid(c.actorKey,serviceMessage(c),value.signature))throw Error('UNAUTHORIZED_OR_STALE_REQUEST');
      challenges.delete(c.nonce);return reply(200,{result:await store.execute(value.request,now)});
    }catch{if(!res.headersSent)store.requiresReopen()?reply(503,{error:'OUTCOME_UNKNOWN_REOPEN_REQUIRED'}):reply(403,{error:'REQUEST_REJECTED'});}
  });
  server.headersTimeout=5000;server.requestTimeout=5000;server.maxConnections=16;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{address=server.address();resolve();});});
  let closing;return {url:'http://127.0.0.1:'+address.port,close:()=>closing??=(async()=>{challenges.clear();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await store.close();})()};
}
