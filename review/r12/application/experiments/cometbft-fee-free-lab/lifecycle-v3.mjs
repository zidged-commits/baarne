// Explicit synthetic V3 ledger policy. Frozen M1 signatures remain unchanged.
import {createPublicKey,verify} from 'node:crypto';
import {canonical,digest} from './application.mjs';
import {enrollmentBody,enrollmentMessage} from './enrollment.mjs';
import {evmEoaVerifier} from '../../packages/identity/src/evm-eoa.ts';
import {initializeRecoveryLab,applyRecoveryLab,RECOVERY_DOMAIN} from './recovery.mjs';
import {initializeMembershipState,validateMembershipEvent,createMembershipStateMachine} from '../../packages/membership-state/src/index.mjs';
import {acceptEpochReference} from './reference-authority-v3.mjs';
export const LIFECYCLE_V3='BAARNE_SYNTHETIC_LIFECYCLE_V3';
export const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))throw Error('INVALID_FIELDS');};
export function edValid(key,message,signature){
  if(typeof key!=='string'||!/^[0-9a-f]{64}$/.test(key)||typeof signature!=='string'||!/^[0-9a-f]{128}$/.test(signature))return false;
  return verify(null,Buffer.from(message),createPublicKey({key:Buffer.from('302a300506032b6570032100'+key,'hex'),format:'der',type:'spki'}),Buffer.from(signature,'hex'));
}
export const lifecycleMessage=body=>LIFECYCLE_V3+'\nINTENT\n'+canonical(body);
function actor(event,state){const p=event.payload;switch(event.eventType){
  case 'FOUNDER_INVITATION_ISSUED':return p.founder;
  case 'APPLICATION_OPENED':case 'APPLICATION_CANCELLED':case 'MEMBERSHIP_ACTIVATED':return p.candidate;
  case 'REFERENCE_SLOT_RESERVED':case 'REFERENCE_SLOT_RELEASED':return p.issuer;
  case 'REFERENCE_RECORDED':return state.reservations[p.reservationId]?.issuer;
  case 'MEMBERSHIP_RESIGNED':return p.member;
  default:throw Error('UNSUPPORTED_POLICY');}}
export async function createLifecycle(config,bootstrap){
  exact(config,['domain','mode','membership','maxAccounts']);
  if(config.domain!==LIFECYCLE_V3||config.mode!=='ISOLATED_SYNTHETIC_LAB'||!Number.isSafeInteger(config.maxAccounts)||config.maxAccounts<3||config.maxAccounts>1000)throw Error('INVALID_CONFIG');
  const engine={config:structuredClone(config),anchor:digest(config),state:initializeMembershipState(config.membership),keys:{},enrollments:{},usedKeys:{},referencesV3:{},seen:{},height:0,time:config.membership.createdAt};
  if(!Array.isArray(bootstrap)||bootstrap.length!==config.membership.founders.length)throw Error('INVALID_BOOTSTRAP');
  for(const record of bootstrap){if(!config.membership.founders.includes(record?.body?.identity))throw Error('NONFOUNDER_BOOTSTRAP');await register(engine,record);}
  if(config.membership.founders.some(id=>!Object.hasOwn(engine.keys,id)))throw Error('MISSING_FOUNDER');
  return engine;
}
async function register(engine,record){
  exact(record,['body','legacySignature','transactionSignature','recoverySignature']);const b=enrollmentBody(record.body);
  if(b.network!==engine.config.membership.networkId||b.genesisHash!==engine.anchor)throw Error('WRONG_SCOPE');
  if(Object.hasOwn(engine.keys,b.identity)||Object.values(engine.enrollments).some(r=>r.body.nonce===b.nonce))throw Error('ALREADY_REGISTERED');
  if(Object.keys(engine.keys).length>=engine.config.maxAccounts)throw Error('ACCOUNT_QUOTA');
  if(Object.hasOwn(engine.usedKeys,b.transactionKey)||Object.hasOwn(engine.usedKeys,b.recoveryKey))throw Error('KEY_ALREADY_BOUND');
  if(typeof record.legacySignature!=='string'||!/^0x[0-9a-f]{130}$/.test(record.legacySignature)||await evmEoaVerifier.verify(enrollmentMessage(b,'LEGACY_IDENTITY'),record.legacySignature,b.identity)!=='VALID')throw Error('OWNER_NOT_PROVEN');
  if(!edValid(b.transactionKey,enrollmentMessage(b,'TRANSACTION_KEY'),record.transactionSignature)||!edValid(b.recoveryKey,enrollmentMessage(b,'RECOVERY_KEY'),record.recoverySignature))throw Error('POSSESSION_NOT_PROVEN');
  engine.keys[b.identity]=initializeRecoveryLab({domain:RECOVERY_DOMAIN,network:b.network,account:digest({identity:b.identity,genesisHash:engine.anchor}),signingKey:b.transactionKey,recoveryKey:b.recoveryKey});
  engine.enrollments[b.identity]=structuredClone(record);
  engine.usedKeys[b.transactionKey]=true;engine.usedKeys[b.recoveryKey]=true;
}
export function lifecycleView(engine){const document=structuredClone(engine);return {document,appHash:digest(document)};}
export async function applyLifecycleBlock(engine,input){
  exact(input,['height','time','txs']);
  if(input.height!==engine.height+1||input.height>1000||!Number.isSafeInteger(input.time)||input.time<engine.time||!Array.isArray(input.txs)||input.txs.length>64||Buffer.byteLength(canonical(input))>256*1024)throw Error('INVALID_BLOCK');
  const rows=[];
  for(const raw of input.txs){try{
    if(typeof raw!=='string'||Buffer.byteLength(raw)>16384)throw Error('INVALID_SIZE');
    const tx=JSON.parse(raw);if(canonical(tx)!==raw)throw Error('NONCANONICAL');
    const id=digest(tx);if(Object.hasOwn(engine.seen,id)){rows.push({status:'DUPLICATE'});continue;}
    const next=structuredClone(engine);
    if(tx.kind==='REGISTER'){
      exact(tx,['kind','record']);await register(next,tx.record);
    }else if(tx.kind==='EPOCH_REFERENCE'){
      exact(tx,['kind','record']);const receipt=acceptEpochReference(next,tx.record,input.time);
      if(Object.keys(next.referencesV3).length>=1000)throw Error('REFERENCE_QUOTA');
      next.referencesV3[receipt.recordHash]={record:tx.record,receipt};
    }else if(tx.kind==='RECOVER'){
      exact(tx,['kind','identity','record']);if(!Object.hasOwn(next.keys,tx.identity))throw Error('UNKNOWN_ACCOUNT');
      const result=applyRecoveryLab(next.keys[tx.identity],tx.record);if(result.status!=='RECOVERED')throw Error(result.status);
      if(Object.hasOwn(next.usedKeys,result.state.signingKey))throw Error('KEY_ALREADY_BOUND');
      next.keys[tx.identity]=result.state;
      next.usedKeys[result.state.signingKey]=true;
    }else{
      exact(tx,['body','signature']);const b=tx.body;exact(b,['domain','anchor','identity','epoch','nonce','event']);
      if(b.domain!==LIFECYCLE_V3||b.anchor!==next.anchor||typeof b.identity!=='string'||!Object.hasOwn(next.keys,b.identity))throw Error('WRONG_SCOPE');
      const key=next.keys[b.identity];if(b.epoch!==key.epoch)throw Error('STALE_EPOCH');
      if(typeof b.nonce!=='string'||!/^[0-9a-f]{64}$/.test(b.nonce)||Object.hasOwn(next.seen,'nonce:'+b.identity+':'+b.epoch+':'+b.nonce))throw Error('INVALID_NONCE');
      if(!edValid(key.signingKey,lifecycleMessage(b),tx.signature))throw Error('INVALID_SIGNATURE');
      const event=validateMembershipEvent(b.event);if(actor(event,next.state)!==b.identity)throw Error('UNAUTHORIZED_ACTOR');
      // The current epoch authorizes the exact complete V1 reference package.
      // Original EVM signature alone cannot submit new references on this ledger.
      const machine=createMembershipStateMachine({eventOrdering:'EXTERNAL_FINALIZED',resolveOccurredAt:()=>input.time});
      const result=await machine.applyEvent(next.state,event);if(result.status!=='ACCEPTED')throw Error(result.status);next.state=result.state;
      next.seen['nonce:'+b.identity+':'+b.epoch+':'+b.nonce]=id;
    }
    next.seen[id]=true;if(Buffer.byteLength(canonical(next))>4*1024*1024)throw Error('STATE_QUOTA');
    Object.assign(engine,next);rows.push({status:tx.kind==='REGISTER'?'REGISTERED':tx.kind==='RECOVER'?'RECOVERED':tx.kind==='EPOCH_REFERENCE'?'REFERENCE_ACCEPTED':'APPLIED'});
  }catch(e){rows.push({status:'REJECTED',reason:e.message});}}
  engine.height=input.height;engine.time=input.time;return rows;
}
export async function replayLifecycle(config,bootstrap,blocks){
  if(!Array.isArray(blocks)||blocks.length>1000||Buffer.byteLength(canonical(blocks))>16*1024*1024)throw Error('REPLAY_QUOTA');
  const engine=await createLifecycle(config,bootstrap);for(const block of blocks)await applyLifecycleBlock(engine,block);return lifecycleView(engine);
}
