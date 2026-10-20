// V2 isolated transaction-key recovery. Existing EVM portable-reference keys
// and frozen history are NOT rotated by this module.
import {createPublicKey,verify} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {canonical,digest,writeAtomic} from './application.mjs';
import {initializeRecoveryLab,applyRecoveryLab,RECOVERY_DOMAIN} from './recovery.mjs';
import {validateMembershipGenesis,validateMembershipEvent,initializeMembershipState,createMembershipStateMachine} from '../../packages/membership-state/src/index.mjs';
import {MEMBERSHIP_LAB_BLOCK_LIMIT,readMembershipLabStore,validateMembershipLabBlockBytes} from './membership-bounds.mjs';
export const RECOVERABLE_MEMBERSHIP_DOMAIN='BAARNE_FEE_FREE_MEMBERSHIP_RECOVERY_LAB_V2';
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.sort().join(','))throw Error('INVALID_FIELDS');};
const pub=k=>typeof k==='string'&&/^[0-9a-f]{64}$/.test(k);
function config(input){
  exact(input,['domain','membership','signers','recoveryKeys']);
  if(input.domain!==RECOVERABLE_MEMBERSHIP_DOMAIN)throw Error('WRONG_DOMAIN');
  validateMembershipGenesis(input.membership);
  if(!input.signers||!input.recoveryKeys||Array.isArray(input.signers)||Array.isArray(input.recoveryKeys))throw Error('INVALID_BINDINGS');
  const ids=Object.keys(input.signers),keys=new Set();
  if(ids.length<3||ids.length>16||canonical(ids.sort())!==canonical(Object.keys(input.recoveryKeys).sort()))throw Error('INVALID_BINDINGS');
  for(const id of ids){
    if(!/^evm-eoa:0x[0-9a-f]{40}$/.test(id)||/^evm-eoa:0x0+$/.test(id))throw Error('INVALID_BINDINGS');
    for(const key of [input.signers[id],input.recoveryKeys[id]]){
      if(!pub(key)||keys.has(key))throw Error('INVALID_BINDINGS');keys.add(key);
    }
  }
  if(input.membership.founders.some(id=>!Object.hasOwn(input.signers,id)))throw Error('UNBOUND_FOUNDER');
  return structuredClone(input);
}
export function initialKeyStates(input){
  const c=config(input),hash=digest(c);
  return Object.fromEntries(Object.keys(c.signers).map(id=>[id,initializeRecoveryLab({domain:RECOVERY_DOMAIN,
    network:c.membership.networkId,account:digest({identity:id,genesisHash:hash}),
    signingKey:c.signers[id],recoveryKey:c.recoveryKeys[id]})]));
}
function decode(raw,c,keys){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>16384)throw Error('INVALID_SIZE');
  const tx=JSON.parse(raw);exact(tx,['body','id','signature']);
  const b=tx.body;exact(b,['domain','genesisHash','signer','epoch','nonce','event']);
  if(canonical(tx)!==raw)throw Error('NONCANONICAL');
  if(b.domain!==RECOVERABLE_MEMBERSHIP_DOMAIN||b.genesisHash!==digest(c))throw Error('WRONG_SCOPE');
  const event=validateMembershipEvent(b.event);
  if(event.networkId!==c.membership.networkId)throw Error('WRONG_NETWORK');
  if(typeof b.signer!=='string'||!Object.hasOwn(keys,b.signer)||b.epoch!==keys[b.signer].epoch)throw Error('STALE_SIGNING_EPOCH');
  if(typeof b.nonce!=='string'||!/^[0-9a-f]{32}$/.test(b.nonce)||tx.id!==digest(b)||
    typeof tx.signature!=='string'||!/^[0-9a-f]{128}$/.test(tx.signature))throw Error('INVALID_SIGNATURE');
  const key=createPublicKey({key:Buffer.from('302a300506032b6570032100'+keys[b.signer].signingKey,'hex'),format:'der',type:'spki'});
  if(!verify(null,Buffer.from(canonical(b)),key,Buffer.from(tx.signature,'hex')))throw Error('INVALID_SIGNATURE');
  return tx;
}
function actor(event,state){const p=event.payload;switch(event.eventType){
  case 'FOUNDER_INVITATION_ISSUED':return p.founder;
  case 'APPLICATION_OPENED':case 'APPLICATION_CANCELLED':case 'MEMBERSHIP_ACTIVATED':return p.candidate;
  case 'REFERENCE_SLOT_RESERVED':case 'REFERENCE_SLOT_RELEASED':return p.issuer;
  case 'REFERENCE_RECORDED':return state.reservations[p.reservationId]?.issuer;
  case 'MEMBERSHIP_RESIGNED':return p.member;
  default:throw Error('UNSUPPORTED_POLICY');
}}
function recover(raw,c,keys){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>16384)throw Error('INVALID_SIZE');
  const tx=JSON.parse(raw);exact(tx,['kind','identity','record']);
  if(canonical(tx)!==raw||tx.kind!=='KEY_RECOVERY'||typeof tx.identity!=='string'||!Object.hasOwn(keys,tx.identity))throw Error('INVALID_RECOVERY');
  const r=applyRecoveryLab(keys[tx.identity],tx.record);
  if(r.status!=='RECOVERED')throw Error(r.status);
  if(Object.values(keys).some(k=>k.signingKey===r.state.signingKey||k.recoveryKey===r.state.signingKey))throw Error('KEY_ALREADY_BOUND');
  return {identity:tx.identity,state:r.state,id:digest(tx)};
}
export function createRecoverableExecution(input){
  const c=config(input);
  return {config:c,state:initializeMembershipState(c.membership),keys:initialKeyStates(c),
    accepted:new Map(),acceptedBytes:new Set(),nonces:new Set(),height:0,time:c.membership.createdAt};
}
export function executionView(engine){
  const document={domain:RECOVERABLE_MEMBERSHIP_DOMAIN,genesisHash:digest(engine.config),height:engine.height,
    time:engine.time,state:engine.state,keyStates:engine.keys,accepted:[...engine.accepted.values()]};
  return {document,appHash:digest(document)};
}
export function checkRecoverableIntent(raw,engine){try{
  if(typeof raw==='string'&&Buffer.byteLength(raw)<=16384&&JSON.parse(raw).kind==='KEY_RECOVERY')recover(raw,engine.config,engine.keys);
  else decode(raw,engine.config,engine.keys);return {code:0};
}catch(e){return {code:1,reason:e.message};}}
export async function applyRecoverableBlock(engine,blockInput){
  const b=structuredClone(blockInput);exact(b,['height','time','txs']);
  if(!Number.isSafeInteger(b.height)||b.height!==engine.height+1||!Number.isSafeInteger(b.time)||b.time<engine.time||
    !Array.isArray(b.txs)||b.txs.length>64)throw Error('INVALID_BLOCK_ORDER_OR_TIME');
  validateMembershipLabBlockBytes(b);
  const c=engine.config,keys=engine.keys,accepted=engine.accepted,nonces=engine.nonces;
  let state=engine.state;
  const machine=createMembershipStateMachine({eventOrdering:'EXTERNAL_FINALIZED',resolveOccurredAt:()=>b.time}),row=[];
  for(const raw of b.txs){try{
    if(engine.acceptedBytes.has(raw)){row.push({status:'DUPLICATE'});continue;}
    if(typeof raw==='string'&&Buffer.byteLength(raw)<=16384&&JSON.parse(raw).kind==='KEY_RECOVERY'){
      const r=recover(raw,c,keys);keys[r.identity]=r.state;accepted.set(r.id,raw);engine.acceptedBytes.add(raw);row.push({status:'RECOVERED'});continue;
    }
    const tx=decode(raw,c,keys),body=tx.body,nonce=body.signer+':'+body.epoch+':'+body.nonce;
    if(nonces.has(nonce))throw Error('NONCE_ALREADY_USED');
    if(actor(body.event,state)!==body.signer)throw Error('UNAUTHORIZED_SIGNER');
    const r=await machine.applyEvent(state,body.event);row.push({status:r.status});
    if(r.status==='ACCEPTED'){state=r.state;accepted.set(tx.id,raw);engine.acceptedBytes.add(raw);nonces.add(nonce);}
  }catch(e){row.push({status:e.message});}}
  engine.state=state;engine.height=b.height;engine.time=b.time;
  return row;
}
export async function replayRecoverableMembership(input,blocksInput){
  const engine=createRecoverableExecution(input),blocks=structuredClone(blocksInput),results=[];
  if(!Array.isArray(blocks)||blocks.length>MEMBERSHIP_LAB_BLOCK_LIMIT)throw Error('INVALID_BLOCKS');
  for(const block of blocks)results.push(await applyRecoverableBlock(engine,block));
  return {...executionView(engine),results,evidenceMode:'UNAUTHENTICATED_ORDERED_LAB_INPUT',livePilotAuthorized:false};
}
export class RecoverableMembershipApplication{
  #config;#blocks;#view;#pending;#directory;#busy=false;
  constructor(directory,c,blocks,view){this.#directory=directory;this.#config=c;this.#blocks=blocks;this.#view=view;}
  static async create(directory,input){const c=config(input),blocks=[],view=await replayRecoverableMembership(c,blocks);
    await mkdir(directory);await writeAtomic(directory,{domain:RECOVERABLE_MEMBERSHIP_DOMAIN,genesisHash:digest(c),blocks});
    return new RecoverableMembershipApplication(directory,c,blocks,view);}
  static async load(directory,input){const c=config(input),raw=await readMembershipLabStore(join(directory,'state.json')),doc=JSON.parse(raw);
    exact(doc,['state','stateHash']);exact(doc.state,['domain','genesisHash','blocks']);
    if(canonical(doc)!==raw||doc.stateHash!==digest(doc.state)||doc.state.domain!==RECOVERABLE_MEMBERSHIP_DOMAIN||doc.state.genesisHash!==digest(c))throw Error('INVALID_STORE');
    return new RecoverableMembershipApplication(directory,c,doc.state.blocks,await replayRecoverableMembership(c,doc.state.blocks));}
  info(){return {height:this.#blocks.length,stateHash:this.#view.appHash,acceptedCount:this.#view.document.accepted.length};}
  exportState(){return structuredClone(this.#view.document);}
  checkIntent(raw){try{
    if(typeof raw==='string'&&Buffer.byteLength(raw)<=16384&&JSON.parse(raw).kind==='KEY_RECOVERY')recover(raw,this.#config,this.#view.document.keyStates);
    else decode(raw,this.#config,this.#view.document.keyStates);return {code:0};
  }catch(e){return {code:1,reason:e.message};}}
  async stageBlock(height,time,txs){if(this.#pending||this.#busy)throw Error('COMMIT_REQUIRED');this.#busy=true;
    try{const blocks=[...this.#blocks,structuredClone({height,time,txs})],view=await replayRecoverableMembership(this.#config,blocks);
      this.#pending={blocks,view};return {stateHash:view.appHash,results:view.results.at(-1).map(r=>({code:['ACCEPTED','RECOVERED','DUPLICATE'].includes(r.status)?0:1,reason:r.status}))};
    }finally{this.#busy=false;}}
  async commit(){if(!this.#pending||this.#busy)throw Error('FINALIZE_REQUIRED');this.#busy=true;const p=this.#pending;
    try{await writeAtomic(this.#directory,{domain:RECOVERABLE_MEMBERSHIP_DOMAIN,genesisHash:digest(this.#config),blocks:p.blocks});
      this.#blocks=p.blocks;this.#view=p.view;this.#pending=null;return this.info();}finally{this.#busy=false;}}
}
