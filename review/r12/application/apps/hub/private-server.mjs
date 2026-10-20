// Opt-in single-host SYNTHETIC workspace; no production key/identity adoption.
import {randomBytes,generateKeyPairSync,sign,createPrivateKey,createPublicKey} from 'node:crypto';
import {readdir,statfs} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHubServer} from './server.mjs';
import {canonical,digest} from '../../experiments/cometbft-fee-free-lab/application.mjs';
import {exact,edValid} from '../../experiments/cometbft-fee-free-lab/lifecycle-v3.mjs';
import {PrivateVaultStore} from '../../experiments/cometbft-fee-free-lab/vault-service.mjs';
import {PrivateIntroductionStore,PAIR_VERSION} from '../../experiments/cometbft-fee-free-lab/private-introduction.mjs';
import {VAULT_VERSION,accessMessage} from '../../experiments/cometbft-fee-free-lab/private-vault.mjs';
import {createPrivateDirectory} from '../../experiments/cometbft-fee-free-lab/private-directory.mjs';
import {createTwinProfile,answerOnboardingQuestion,setFieldPermission,setDiscoveryEnabled,recommendPeople,DISCOVERY_FIELDS,ONBOARDING_QUESTIONS} from '../../packages/behavioral-twin/src/index.mjs';
import {HUB_PRIVATE_VERSION,hubMessage} from './public/private-protocol.mjs';
import {projectIntroductionProfile} from '../../packages/behavioral-twin/src/handoff-projection.mjs';
import {operatorCheckpoint} from './operator-checkpoint.mjs';
const pub=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const same=(a,b)=>canonical(a)===canonical(b);
const DEFAULT_STORAGE={maxVaultRevision:1000,minFreeBytes:16*1024*1024};
function storagePolicyValid(value){exact(value,['maxVaultRevision','minFreeBytes']);if(!Number.isSafeInteger(value.maxVaultRevision)||value.maxVaultRevision<1||value.maxVaultRevision>1000||!Number.isSafeInteger(value.minFreeBytes)||value.minFreeBytes<1024*1024||value.minFreeBytes>2**50)throw Error('INVALID_SYNTHETIC_STORAGE_POLICY');return structuredClone(value);}
export async function startPrivateHub({directory,mode,port=0,host='127.0.0.1',clock=()=>Math.floor(Date.now()/1000),operatorKey,resumePin,recover=false,pendingPin=null,onDurableState=async()=>{},faultHook=async()=>{},storagePolicy}={}){
  if(mode!=='ISOLATED_SYNTHETIC_LAB'||host!=='127.0.0.1'||typeof directory!=='string'||!Number.isSafeInteger(port)||port<0||port>65535)throw Error('EXPLICIT_LOCAL_SYNTHETIC_WORKSPACE_REQUIRED');
  if(operatorKey!==undefined&&(!Buffer.isBuffer(operatorKey)||operatorKey.length!==32))throw Error('EXTERNAL_SYNTHETIC_OPERATOR_KEY_REQUIRED');
  if(resumePin!==undefined&&operatorKey===undefined)throw Error('EXTERNAL_SYNTHETIC_OPERATOR_KEY_REQUIRED');
  const requestedPolicy=storagePolicy===undefined?null:storagePolicyValid(storagePolicy);
  if(resumePin===undefined)await createPrivateDirectory(directory); // new only unless explicitly pinned resume
  if(typeof onDurableState!=='function'||typeof faultHook!=='function'||(recover||pendingPin)&&operatorKey===undefined)throw Error('EXPLICIT_PINNED_RECOVERY_REQUIRED');
  const checkpoint=operatorKey===undefined?null:await operatorCheckpoint({directory,key:operatorKey,resumePin,recover,pendingPin});
  const recovery=checkpoint?.intent;
  let saved=checkpoint?.state;
  let sessionId,scope,reader,readerKey;
  const owners=new Map(),challenges=new Map(),keys=[],stores=[];
  let pair=null,pairKey=null,address,queue=Promise.resolve(),queued=0,closing,faulted=false,ready=false,writeStop=null,policy=requestedPolicy??DEFAULT_STORAGE;
  // A checkpoint is authenticated by an external operator pin/key; native store
  // replay still verifies every owner-signed transition against its saved head.
  try{
    if(resumePin!==undefined&&(!saved||typeof saved!=='object'||Array.isArray(saved)))throw Error('INVALID_OPERATOR_STATE');
    if(saved){
      exact(saved,['sessionId','readerPrivate','port','owners','pair',...(Object.hasOwn(saved,'storagePolicy')?['storagePolicy','writeStop']:[])]);
      policy=storagePolicyValid(saved.storagePolicy??DEFAULT_STORAGE);if(requestedPolicy&&!same(policy,requestedPolicy))throw Error('STORAGE_POLICY_CHANGE_REQUIRES_SEPARATE_WORKSPACE');
      writeStop=saved.writeStop??null;if(writeStop!==null&&!['DISK_RESERVE_HALT','VAULT_QUOTA','PAIR_QUOTA','PAIR_HISTORY_BYTES_QUOTA'].includes(writeStop))throw Error('INVALID_OPERATOR_WRITE_STOP');
      if(!pub(saved.sessionId)||!Array.isArray(saved.owners)||saved.owners.length>2||!Number.isSafeInteger(saved.port)||saved.port<1||saved.port>65535)throw Error('INVALID_OPERATOR_STATE');
      if(port!==0&&port!==saved.port)throw Error('SAME_ORIGIN_RESTART_REQUIRED');port=saved.port;
      sessionId=saved.sessionId;
      const bytes=Buffer.from(saved.readerPrivate,'base64');
      try{if(bytes.toString('base64')!==saved.readerPrivate||bytes.length>256)throw Error('INVALID_READER_KEY');reader={privateKey:createPrivateKey({key:bytes,format:'der',type:'pkcs8'})};if(reader.privateKey.asymmetricKeyType!=='ed25519')throw Error('INVALID_READER_KEY');reader.publicKey=createPublicKey(reader.privateKey);}finally{bytes.fill(0);}
    }else{sessionId=randomBytes(32).toString('hex');reader=generateKeyPairSync('ed25519');}
    scope={mode,network:'baarne:hub-private-lab',account:sessionId};
    readerKey=reader.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
    if(saved){
      const expected=['operator.lock','operator-checkpoint.json',...(checkpoint.hadActive?['operator-active.json']:[]),...(checkpoint.hasIntent?['operator-intent.json']:[]),...(checkpoint.hasTemporary?['operator-checkpoint.pending']:[])];
      for(const row of saved.owners){
        exact(row,['key','actorId','encryptionKey','profile','deleted','sourceHead','vaultHead','blocked']);
        if(!pub(row.key)||owners.has(row.key)||row.actorId!=='synthetic:user-0'+(owners.size+1)||typeof row.deleted!=='boolean'||typeof row.blocked!=='boolean')throw Error('INVALID_OPERATOR_OWNER');
        const encryptionKey=Buffer.from(row.encryptionKey,'hex');keys.push(encryptionKey);if(!pub(row.encryptionKey))throw Error('INVALID_OPERATOR_KEY');
        if(!same(row.vaultHead.scope,{...scope,account:digest({sessionId,key:row.key})})||row.vaultHead.ownerKey!==row.key||row.sourceHead.revision>row.vaultHead.revision)throw Error('INVALID_OPERATOR_SCOPE');
        const folder=row.actorId.slice(-2);expected.push(folder);
        const target=recovery?.ownerKey===row.key&&recovery.request?.operation==='VAULT'&&recovery.request?.payload?.kind==='COMMAND';
        const names=await readdir(join(directory,folder)),tail=names.filter(n=>/^snapshot-[0-9]{4}\.json$/.test(n)).length===row.vaultHead.revision+2;
        const vault=target&&tail?(await PrivateVaultStore.recover(join(directory,folder),encryptionKey,row.vaultHead,recovery.request.payload.record)).store:await PrivateVaultStore.load(join(directory,folder),encryptionKey,row.vaultHead);stores.push(vault);
        const owner={...row,vault,encryptionKey,grantId:digest({sessionId,readerKey,key:row.key})};owners.set(row.key,owner);
        if(target&&tail){vaultGuard(owner,recovery.request.payload);applyVaultCache(owner,recovery.request.payload.record,row.vaultHead);}
      }
      if((saved.pair!==null)!==(owners.size===2))throw Error('INVALID_OPERATOR_PAIR');
      if(saved.pair){
        exact(saved.pair,['encryptionKey','head']);if(!pub(saved.pair.encryptionKey)||!same(saved.pair.head.scope,scope))throw Error('INVALID_OPERATOR_PAIR');pairKey=Buffer.from(saved.pair.encryptionKey,'hex');keys.push(pairKey);
        const target=recovery?.request?.operation==='PAIR'&&recovery.request?.payload?.kind==='COMMAND',names=await readdir(join(directory,'pair')),tail=names.filter(n=>/^pair-[0-9]{4}\.json$/.test(n)).length===saved.pair.head.revision+2;
        pair=target&&tail?(await PrivateIntroductionStore.recover(join(directory,'pair'),pairKey,saved.pair.head,recovery.request.payload.record)).store:await PrivateIntroductionStore.load(join(directory,'pair'),pairKey,saved.pair.head);stores.push(pair);expected.push('pair');
        if(target&&tail){const owner=owners.get(recovery.ownerKey);if(!owner)throw Error('WRONG_OPERATOR_RECOVERY_ACTOR');pairGuard(owner,recovery.request.payload);applyPairCache(owner,recovery.request.payload,saved.pair.head);}
      }
      if(!same((await readdir(directory)).sort(),expected.sort()))throw Error('UNEXPECTED_OPERATOR_ENTRY');
    }
    if(checkpoint){checkpoint.state=null;await checkpoint.activate();}saved=null;
  }catch(error){await Promise.all(stores.map(s=>s.close()));keys.forEach(k=>k.fill(0));await checkpoint?.close();throw error;}
  const nonce=()=>randomBytes(32).toString('hex');
  const readSignature=body=>sign(null,Buffer.from(accessMessage(body)),reader.privateKey).toString('hex');
  const context=owner=>({sessionId,actorId:owner.actorId,ownerKey:owner.key,readerKey,grantId:owner.grantId,vaultHead:owner.vault.publicHead(),pairHead:pair?.publicHead()??null,needsSourceSync:!same(owner.sourceHead,owner.vault.publicHead()),productionAuthorized:false});
  function snapshot(){const bytes=reader.privateKey.export({type:'pkcs8',format:'der'});try{return {sessionId,readerPrivate:bytes.toString('base64'),port:address?.port??port,storagePolicy:policy,writeStop,owners:[...owners.values()].map(o=>({key:o.key,actorId:o.actorId,encryptionKey:o.encryptionKey.toString('hex'),profile:o.profile,deleted:o.deleted,blocked:o.blocked,sourceHead:o.sourceHead,vaultHead:o.vault.publicHead()})),pair:pair?{encryptionKey:pairKey.toString('hex'),head:pair.publicHead()}:null};}finally{bytes.fill(0);}}
  function allSynced(){return [...owners.values()].every(o=>same(o.sourceHead,o.vault.publicHead()));}
  function vaultGuard(owner,payload){
    exact(payload,['kind','record']);if(!['COMMAND','STATUS','OWNER_VIEW','OWNER_STATE'].includes(payload.kind)||owner.vault.actor(payload)!==owner.key)throw Error('OWNER_ONLY');
    if(payload.kind==='COMMAND'&&payload.record?.body?.action==='GRANT'){const grant=payload.record.body.payload;if(grant.id!==owner.grantId||grant.readerKey!==readerKey)throw Error('ONLY_SCOPED_DISCOVERY_GRANT');}
  }
  function applyVaultCache(owner,record,prior){
    const now=owner.vault.publicHead();if(now.revision<=prior.revision||now.revision!==record.body.revision)return;
    const wasSynced=same(owner.sourceHead,prior),action=record.body.action;
    if(action==='PROFILE')owner.profile=structuredClone(record.body.payload);
    if(action==='DELETE'){owner.deleted=true;owner.profile=null;}
    if(wasSynced&&['GRANT','REVOKE'].includes(action))owner.sourceHead=now;
  }
  function pairGuard(owner,payload){
    if(!pair)throw Error('PEER_NOT_ENROLLED');exact(payload,['kind','record']);if(!['READ','COMMAND','STATUS'].includes(payload.kind)||pair.actor(payload)!==owner.key)throw Error('PARTICIPANT_ONLY');
    const b=payload.record.body;if(payload.kind==='READ'&&!allSynced())throw Error('SOURCE_SYNC_REQUIRED');
    if(payload.kind==='COMMAND'){
      if(!['INTEREST','APPROVE','CONNECT','DECLINE','WITHDRAW','BLOCK','HANDOFF','SOURCE_NOTICE'].includes(b.operation))throw Error('PRIVATE_FLOW_OPERATION_REQUIRED');
      if(['HANDOFF','SOURCE_NOTICE'].includes(b.operation)){
        const source=b.payload.handoff?.body?.sourceHead??b.payload.notice?.body?.sourceHead;if(!same(source,owner.vault.publicHead()))throw Error('CURRENT_SOURCE_HEAD_REQUIRED');
        if(b.operation==='HANDOFF'&&(!owner.profile||!same(b.payload.handoff.body.profile,projectIntroductionProfile(owner.profile,b.payload.handoff.body.fields))))throw Error('CURRENT_MINIMAL_SOURCE_PROFILE_REQUIRED');
        if(b.operation==='SOURCE_NOTICE'&&(b.payload.notice.body.action==='DELETE')!==owner.deleted)throw Error('SOURCE_TOMBSTONE_MISMATCH');
      }else if(!allSynced())throw Error('SOURCE_SYNC_REQUIRED');
    }
  }
  function applyPairCache(owner,payload,prior){
    if(payload.kind!=='COMMAND'||pair.publicHead().revision<=prior.revision)return;
    const b=payload.record.body;if(['HANDOFF','SOURCE_NOTICE'].includes(b.operation))owner.sourceHead=owner.vault.publicHead();
    if(b.operation==='BLOCK')for(const o of owners.values())o.blocked=true;
  }
  async function enroll(key){
    if(owners.has(key))return context(owners.get(key));
    if(owners.size>=2)throw Error('TWO_SYNTHETIC_PARTICIPANTS_ONLY');
    const actorId='synthetic:user-0'+(owners.size+1),encryptionKey=randomBytes(32);keys.push(encryptionKey);
    const profile=createTwinProfile({userId:actorId,displayLabel:'Synthetic participant '+(owners.size+1),now:0});
    const vault=await PrivateVaultStore.create(join(directory,actorId.slice(-2)),{...scope,account:digest({sessionId,key})},key,profile,encryptionKey);
    stores.push(vault);const owner={key,actorId,vault,encryptionKey,profile,deleted:false,blocked:false,sourceHead:vault.publicHead(),grantId:digest({sessionId,readerKey,key})};owners.set(key,owner);
    if(owners.size===2){pairKey=randomBytes(32);keys.push(pairKey);pair=await PrivateIntroductionStore.create(join(directory,'pair'),pairKey,{version:PAIR_VERSION,scope,participants:[...owners.values()].map(o=>({ownerKey:o.key,profile:createTwinProfile({userId:o.actorId,displayLabel:'Synthetic introduction participant',now:0})}))});stores.push(pair);}
    return context(owner);
  }
  async function discoveryProfile(owner){
    const head=owner.vault.publicHead(),body={version:VAULT_VERSION,scope:head.scope,revision:head.revision,purpose:'DISCOVERY',grantId:owner.grantId,nonce:nonce()};
    let attributes;try{attributes=await owner.vault.execute({kind:'READ',record:{body,signature:readSignature(body)}},clock());}catch{return null;}
    if(!attributes)return null;
    let p=createTwinProfile({userId:owner.actorId,displayLabel:'Synthetic participant '+owner.actorId.slice(-2),now:0});
    for(const q of ONBOARDING_QUESTIONS){const values=(attributes[q.field]??[]).filter(v=>q.options.includes(v));if(values.length)p=answerOnboardingQuestion(p,{questionId:q.id,values,useForDiscovery:true,now:1});}
    for(const field of Object.keys(attributes))p=setFieldPermission(p,{purpose:'discovery',field,allowed:true,now:1});
    return setDiscoveryEnabled(p,{enabled:true,now:1});
  }
  async function execute(key,request){
    exact(request,['operation','payload']);const {operation,payload}=request;
    if(operation==='ENROLL'){exact(payload,[]);return enroll(key);}
    const owner=owners.get(key);if(!owner)throw Error('ENROLL_FIRST');
    if(operation==='CONTEXT'){exact(payload,[]);return context(owner);}
    if(operation==='VAULT'){
      vaultGuard(owner,payload);const prior=owner.vault.publicHead();
      if(payload.kind==='COMMAND'&&payload.record.body.revision>policy.maxVaultRevision)throw Error('VAULT_QUOTA');
      const result=await owner.vault.execute(payload,clock());
      // An idempotent replay returns the current head. It must not rewind the
      // live projection/consent cache to the old command's plaintext payload.
      if(payload.kind==='COMMAND')applyVaultCache(owner,payload.record,prior);
      return result;
    }
    if(operation==='PAIR'){
      pairGuard(owner,payload);const prior=pair.publicHead();
      const result=await pair.execute(payload);
      applyPairCache(owner,payload,prior);
      return result;
    }
    if(operation==='DISCOVER'){
      exact(payload,[]);if(pair&&!allSynced())throw Error('SOURCE_SYNC_REQUIRED');
      const profiles=(await Promise.all([...owners.values()].map(discoveryProfile))).filter(Boolean);
      if(!profiles.some(p=>p.userId===owner.actorId))return [];
      // Blocking is pair-authorized and deliberately excludes this pair thereafter.
      if(pair&&owner.blocked)return [];
      return recommendPeople(owner.actorId,profiles,{mode:'combined'}).map(r=>({targetUserId:r.targetUserId,targetLabel:r.targetLabel,explanations:r.explanations}));
    }
    throw Error('UNSUPPORTED_PRIVATE_OPERATION');
  }
  async function durableExecute(key,request){
    const mutation=request.operation==='ENROLL'||['VAULT','PAIR'].includes(request.operation)&&request.payload?.kind==='COMMAND';
    if(!mutation)return execute(key,request);
    if(writeStop)throw Error('OPERATOR_WRITE_STOP');
    if(!checkpoint)return execute(key,request);
    const before=snapshot(),count=keys.length;let result,rejected;
    try{
      const prepared=await checkpoint.prepare(before,key,request);await onDurableState({...prepared,phase:'PREPARED'});await faultHook('beforeNativeMutation');
      try{const disk=await statfs(directory);if(disk.bavail*disk.bsize<policy.minFreeBytes)throw Error('DISK_RESERVE_HALT');result=await execute(key,request);}catch(error){if(stores.some(s=>s.requiresReopen())||request.operation==='ENROLL'&&keys.length!==count)throw error;if(['DISK_RESERVE_HALT','VAULT_QUOTA','PAIR_QUOTA','PAIR_HISTORY_BYTES_QUOTA'].includes(error.message))writeStop=error.message;rejected=error;}
      await faultHook('afterNativeMutation');const committed=await checkpoint.persist(snapshot());await onDurableState({...committed,pendingPin:null,phase:'COMMITTED'});await faultHook('afterCheckpoint');await checkpoint.clearIntent();
    }catch(error){faulted=true;throw error;}
    if(rejected)throw rejected;return result;
  }
  async function handler(req,res){
    const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});res.end(JSON.stringify(data));};
    try{
      if(!ready||closing||faulted)return reply(503,{error:'WORKSPACE_CLOSING_OR_FAULTED'});
      checkpoint?.assertOwned();
      const origin='http://127.0.0.1:'+address.port;
      if(req.method!=='POST'||!['/private-api/challenge','/private-api/request'].includes(req.url)||req.headers.host!=='127.0.0.1:'+address.port||req.headers.origin!==origin||req.headers['x-baarne-client']!==HUB_PRIVATE_VERSION||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return reply(403,{error:'SAME_ORIGIN_LOCAL_CLIENT_REQUIRED'});
      if(req.headers['content-type']!=='application/json')return reply(415,{error:'JSON_REQUIRED'});
      let size=0;const chunks=[];for await(const chunk of req){if((size+=chunk.length)>48000){reply(413,{error:'REQUEST_QUOTA'});req.destroy();return;}chunks.push(chunk);}
      const raw=new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)),value=JSON.parse(raw);if(canonical(value)!==raw)throw Error('NONCANONICAL_REQUEST');
      const now=clock();for(const [id,c] of challenges)if(c.expiresAt<=now)challenges.delete(id);
      if(req.url==='/private-api/challenge'){
        exact(value,['ownerKey','requestHash']);if(!pub(value.ownerKey)||!pub(value.requestHash)||challenges.size>=128)throw Error('CHALLENGE_QUOTA_OR_FORMAT');
        const challenge={version:HUB_PRIVATE_VERSION,sessionId,ownerKey:value.ownerKey,requestHash:value.requestHash,nonce:nonce(),expiresAt:now+15};challenges.set(challenge.nonce,challenge);return reply(200,{challenge});
      }
      exact(value,['challenge','signature','request']);const c=value.challenge,saved=challenges.get(c?.nonce);
      if(!saved||!same(c,saved)||c.expiresAt<=now||digest(value.request)!==c.requestHash||!edValid(c.ownerKey,hubMessage(c),value.signature))throw Error('INVALID_OWNER_REQUEST');
      challenges.delete(c.nonce);if(queued>=16)return reply(429,{error:'LOCAL_REQUEST_QUOTA'});
      const previous=queue;let release;queue=new Promise(ok=>{release=ok;});queued++;await previous;
      try{
        if(closing||faulted)throw Error('WORKSPACE_CLOSING_OR_FAULTED');checkpoint?.assertOwned();
        const result=await durableExecute(c.ownerKey,value.request);
        reply(200,{result});
      }finally{queued--;release();}
    }catch(error){if(stores.some(s=>s.requiresReopen()))faulted=true;if(!res.headersSent)reply(403,{error:['SOURCE_SYNC_REQUIRED','PEER_NOT_ENROLLED','CURRENT_SOURCE_HEAD_REQUIRED'].includes(error.message)?error.message:'PRIVATE_REQUEST_REJECTED'});}
  }
  const server=createHubServer({privateHandler:handler});server.headersTimeout=5000;server.requestTimeout=5000;server.maxConnections=16;
  try{
    await new Promise((ok,no)=>{server.once('error',no);server.listen(port,host,()=>{address=server.address();ok();});});
    if(checkpoint&&(resumePin===undefined||recover)){if(recover)await checkpoint.clearRecoveryTemporary();const state=await checkpoint.persist(snapshot());await onDurableState({...state,pendingPin:null,phase:recover?'RECOVERED':'INITIAL'});await checkpoint.clearIntent();}
    ready=true;
  }catch(error){server.closeAllConnections();await new Promise(ok=>server.close(ok));await Promise.all(stores.map(s=>s.close()));keys.forEach(k=>k.fill(0));await checkpoint?.close();throw error;}
  return {url:'http://127.0.0.1:'+address.port,productionAuthorized:false,
    durableState:()=>checkpoint?.publicState()??null,
    storageState:()=>({policy:structuredClone(policy),vaultRevisions:[...owners.values()].map(o=>o.vault.publicHead().revision),pairRevision:pair?.publicHead().revision??null,pendingMutation:Boolean(checkpoint?.publicState().pendingPin),writeStopReason:writeStop,headsAreNotConsensusProof:true}),
    health:()=>({mode,state:closing?'CLOSING_OR_CLOSED':faulted?'FAULTED':'RUNNING',durableCheckpoint:Boolean(checkpoint),participants:owners.size,...(writeStop?{writeStopReason:writeStop}:{}),productionAuthorized:false}),
    close:()=>closing??=(async()=>{
      challenges.clear();await new Promise(ok=>{server.close(ok);server.closeAllConnections();});await queue;
      try{
        if(checkpoint){
          checkpoint.assertOwned();if(faulted||stores.some(s=>s.requiresReopen())||(owners.size===2)!==Boolean(pair))throw Error('UNCERTAIN_STORE_REQUIRES_REVIEW');
          return await checkpoint.finish(snapshot());
        }
        return {state:'CLOSED_SESSION_MEMORY_ONLY',productionAuthorized:false};
      }finally{
        try{await Promise.all(stores.map(s=>s.close()));}
        finally{keys.forEach(k=>k.fill(0));reader=null;await checkpoint?.close();}
      }
    })()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3)throw Error('USAGE: node apps/hub/private-server.mjs NEW_SYNTHETIC_DIRECTORY');
  const app=await startPrivateHub({directory:process.argv[2],mode:'ISOLATED_SYNTHETIC_LAB'});
  console.log('BAARNE private synthetic workspace: '+app.url+'/private.html');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
