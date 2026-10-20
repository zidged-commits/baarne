// Network-free semantic replay. Consensus signatures are verified separately in Go.
import {writeFile} from 'node:fs/promises';
import {replayMembershipLab} from './membership.mjs';
import {readBoundedRegularFile} from './bounded-input.mjs';
const [packetFile,outputFile]=process.argv.slice(2);
const raw=await readBoundedRegularFile(packetFile,16*1024*1024,'INVALID_PROOF_PACKET','INPUT_TOO_LARGE');
let packet;
try{packet=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));}catch{throw Error('INVALID_PROOF_PACKET');}
if(packet.genesis.config?.domain==='BAARNE_SYNTHETIC_LIFECYCLE_V3'){
  if(process.argv.includes('--require-enrollment'))throw Error('V3_BOOTSTRAP_PROFILE_REQUIRED');
  const {createLifecycle,applyLifecycleBlock,lifecycleView}=await import('./lifecycle-v3.mjs');
  if(!Array.isArray(packet.blocks)||packet.blocks.length<2||packet.blocks.length>1001)throw Error('INVALID_BLOCKS');
  const engine=await createLifecycle(packet.genesis.config,packet.genesis.bootstrap),initialState=lifecycleView(engine).document,hashes=[],results=[];
  for(const {block} of packet.blocks.slice(0,-1)){const rows=await applyLifecycleBlock(engine,{height:Number(block.header.height),time:Math.floor(Date.parse(block.header.time)/1000),txs:(block.data.txs??[]).map(x=>new TextDecoder('utf8',{fatal:true}).decode(Buffer.from(x,'base64')))});hashes.push(lifecycleView(engine).appHash);results.push(rows.map(r=>({code:r.status==='REJECTED'?1:0})));}
  const view=lifecycleView(engine);await writeFile(outputFile,JSON.stringify({initialState,hashes,results,state:view.document,info:{height:engine.height,stateHash:view.appHash,acceptedCount:Object.keys(engine.seen).filter(k=>!k.startsWith('nonce:')).length}}),{flag:'wx'});process.exit(0);
}
let enrollmentReceipts;
if(process.argv.includes('--require-enrollment')&&!Object.hasOwn(packet,'enrollments'))throw Error('MISSING_ENROLLMENT');
if(Object.hasOwn(packet,'enrollments')){
  enrollmentReceipts=(await (await import('./enrollment.mjs')).reviewGenesisEnrollments(packet.genesis,packet.enrollments)).receipts;
}
const replayFunction=packet.genesis.domain==='BAARNE_FEE_FREE_MEMBERSHIP_RECOVERY_LAB_V2'?
  (await import('./membership-recovery.mjs')).replayRecoverableMembership:replayMembershipLab;
if(!Array.isArray(packet.blocks)||packet.blocks.length<2||packet.blocks.length>5000)throw Error('INVALID_BLOCKS');
const blocks=packet.blocks.slice(0,-1).map(({block})=>({height:Number(block.header.height),
  time:Math.floor(Date.parse(block.header.time)/1000),
  txs:(block.data.txs??[]).map(x=>new TextDecoder('utf8',{fatal:true}).decode(Buffer.from(x,'base64')))}));
const initial=await replayFunction(packet.genesis,[]),hashes=[],results=[];
const incremental=packet.genesis.domain==='BAARNE_FEE_FREE_MEMBERSHIP_RECOVERY_LAB_V2'?
  await import('./membership-recovery.mjs'):null;
const engine=incremental?.createRecoverableExecution(packet.genesis);
let replay=initial;
for(let i=0;i<blocks.length;i++) {
  if(engine){const row=await incremental.applyRecoverableBlock(engine,blocks[i]);replay={...incremental.executionView(engine),results:[row]};}
  else replay=await replayFunction(packet.genesis,blocks.slice(0,i+1));
  hashes.push(replay.appHash);
  results.push(replay.results.at(-1).map(r=>({code:['ACCEPTED','RECOVERED','DUPLICATE'].includes(r.status)?0:1})));
}
await writeFile(outputFile,JSON.stringify({initialState:initial.document,hashes,results,state:replay.document,
  info:{height:blocks.length,stateHash:replay.appHash,acceptedCount:replay.document.accepted.length},
  ...(enrollmentReceipts?{enrollmentReceipts}:{} )}),{flag:'wx'});
