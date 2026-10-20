// Public V3 lab export boundary only. Never authorizes a release or consensus.
import {createLifecycle,applyLifecycleBlock,lifecycleView} from './lifecycle-v3.mjs';
import {enrollmentBody} from './enrollment.mjs';
import {validateMembershipEvent} from '../../packages/membership-state/src/index.mjs';
import {parseUniqueObserverJson} from './observer-stdio.mjs';

const fail=()=>{throw Error('NONPUBLIC_LIFECYCLE_EVIDENCE');};
const forbidden=/^(?:private_?key|secret(?:_?key)?|recovery_?(?:seed|material)|seed(?:_?phrase)?|mnemonic|password|passphrase|credentials?|access_?token|api_?key|aws_secret_access_key|github_token|gh_token|openai_api_key|profile|profiles|private_?profile|wallet|people)$/i;
const secretText=/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/;
// Descriptor inspection refuses accessors/toJSON and unknown prototypes before
// serialization. This is not a detector for arbitrary secrets in public values.
function publicData(value,depth=0,budget={items:0}){
  if(depth>32||++budget.items>250000)fail();
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))fail();return value;}
  if(typeof value==='string'){if(Buffer.byteLength(value)>2*1024*1024||secretText.test(value))fail();return value;}
  if(typeof value!=='object'||!value)fail();
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)fail();
  const keys=Reflect.ownKeys(value);
  if(keys.length>(array?20000:2048)||keys.some(k=>typeof k!=='string'))fail();
  if(array&&keys.length!==value.length+1)fail();
  const output=array?[]:{};
  for(const key of keys){
    if(array&&key==='length')continue;
    if(forbidden.test(key)||key==='toJSON'||key==='__proto__'||key==='constructor'||key==='prototype')fail();
    if(array&&!/^(?:0|[1-9][0-9]*)$/.test(key))fail();
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)fail();
    output[key]=publicData(descriptor.value,depth+1,budget);
  }
  if(array&&output.length!==value.length)fail();
  return output;
}
function exact(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail();
}
export function parsePublicLifecycleJson(raw){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>16*1024*1024)fail();
  try{return publicData(parseUniqueObserverJson(raw));}catch{fail();}
}
const GENESIS_KEYS=['genesisVersion','stateMachineVersion','networkId','createdAt','founderInvitationClosesAt','founders'];
const BODY_KEYS=['version','purpose','network','genesisHash','identity','transactionKey','recoveryKey','nonce'];

export async function publicLifecycleGenesis(input){
  const data=publicData(input);
  exact(data,['config','bootstrap']);
  exact(data.config,['domain','mode','membership','maxAccounts']);
  exact(data.config.membership,GENESIS_KEYS);
  if(!Array.isArray(data.bootstrap))fail();
  const config={domain:data.config.domain,mode:data.config.mode,
    membership:Object.fromEntries(GENESIS_KEYS.map(key=>[key,data.config.membership[key]])),
    maxAccounts:data.config.maxAccounts};
  const bootstrap=data.bootstrap.map(record=>{
    exact(record,['body','legacySignature','transactionSignature','recoverySignature']);
    exact(record.body,BODY_KEYS);
    return {body:Object.fromEntries(BODY_KEYS.map(key=>[key,record.body[key]])),
      legacySignature:record.legacySignature,transactionSignature:record.transactionSignature,
      recoverySignature:record.recoverySignature};
  });
  // In particular, recoveryKey is public and must prove the corresponding
  // recovery-role possession. Dropping it would invalidate the authentic input.
  await createLifecycle(config,bootstrap);
  return {config,bootstrap};
}

function blockId(value){exact(value,['hash','parts']);exact(value.parts,['total','hash']);}
const HEADER_KEYS=['version','chain_id','height','time','last_block_id','last_commit_hash',
  'data_hash','validators_hash','next_validators_hash','consensus_hash','app_hash',
  'last_results_hash','evidence_hash','proposer_address'];
function publicEnrollment(record){
  exact(record,['body','legacySignature','transactionSignature','recoverySignature']);
  enrollmentBody(record.body);
}
function publicTransaction(value){
  publicData(value);
  if(value?.kind==='REGISTER'){
    exact(value,['kind','record']);publicEnrollment(value.record);
  }else if(value?.kind==='RECOVER'||value?.kind==='EPOCH_REFERENCE'){
    const recover=value.kind==='RECOVER';
    exact(value,recover?['kind','identity','record']:['kind','record']);
    if(typeof value.record!=='string')fail();
    const record=parsePublicLifecycleJson(value.record);
    exact(record,recover?['body','recoverySignature','newKeySignature']:['body','signature']);
    exact(record.body,recover?['domain','network','account','genesisHash','epoch','previousHead','newSigningKey']:
      ['version','anchor','issuer','subject','epoch','issuedAt','expiresAt','nonce']);
  }else{
    exact(value,['body','signature']);
    exact(value.body,['domain','anchor','identity','epoch','nonce','event']);
    validateMembershipEvent(value.body.event);
  }
}
function publicBlock(input){
  const row=publicData(input);
  exact(row,['block_id','block']);blockId(row.block_id);
  const b=row.block;
  exact(b,['header','data','evidence','last_commit']);exact(b.header,HEADER_KEYS);
  exact(b.header.version,['block','app']);blockId(b.header.last_block_id);
  exact(b.data,['txs']);exact(b.evidence,['evidence']);
  // This export profile is the existing no-evidence synthetic lifecycle lab.
  // Unsupported Byzantine evidence requires a separate reviewed export profile.
  if(!Array.isArray(b.evidence.evidence)||b.evidence.evidence.length!==0)fail();
  if(b.last_commit!==null){
    exact(b.last_commit,['height','round','block_id','signatures']);blockId(b.last_commit.block_id);
    if(!Array.isArray(b.last_commit.signatures)||b.last_commit.signatures.length>1000)fail();
    for(const signature of b.last_commit.signatures)exact(signature,['block_id_flag','validator_address','timestamp','signature']);
  }
  if(b.data.txs!==null&&!Array.isArray(b.data.txs)||b.data.txs?.length>64)fail();
  for(const tx of b.data.txs??[]){
    if(typeof tx!=='string'||tx.length>24000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(tx))fail();
    const raw=new TextDecoder('utf8',{fatal:true}).decode(Buffer.from(tx,'base64'));
    // Check decoded transaction properties as well, including escaped key names.
    // Never redact/drop a transaction: that would change certified block bytes.
    const value=parsePublicLifecycleJson(raw);
    publicTransaction(value);
    if(/"(?:private_?key|secret_?key|recovery_?seed|seed|mnemonic|password|passphrase)"\s*:/i.test(raw))fail();
  }
  return row;
}

export async function publicLifecycleProof(input){
  const data=publicData(input);
  exact(data,['genesis','blocks']);
  const genesis=await publicLifecycleGenesis(data.genesis);
  if(!Array.isArray(data.blocks)||data.blocks.length<2||data.blocks.length>1001)fail();
  const blocks=data.blocks.map(publicBlock);
  if(Buffer.byteLength(JSON.stringify(blocks))>16*1024*1024)fail();
  const engine=await createLifecycle(genesis.config,genesis.bootstrap),hashes=[],results=[],blockResults=[];
  for(const {block} of blocks.slice(0,-1)){
    const height=Number(block.header.height),rows=await applyLifecycleBlock(engine,{height,
      time:Math.floor(Date.parse(block.header.time)/1000),txs:(block.data.txs??[]).map(tx=>new TextDecoder('utf8',{fatal:true}).decode(Buffer.from(tx,'base64')))});
    const view=lifecycleView(engine),txs_results=rows.map(row=>({code:row.status==='REJECTED'?1:0,
      data:null,log:'',info:'',gas_wanted:'0',gas_used:'0',events:[],codespace:''}));
    hashes.push(view.appHash);results.push(txs_results);
    blockResults.push({height:String(height),txs_results,finalize_block_events:[],validator_updates:[],
      consensus_param_updates:null,app_hash:Buffer.from(view.appHash,'hex').toString('base64')});
  }
  const view=lifecycleView(engine);
  const output={status:'PASSED',profile:'V3_RECONSTRUCTED_RESULTS_REQUIRE_CERTIFICATE_VERIFICATION',
    genesis,blocks,blockResults,replay:{hashes,results,state:view.document,info:{height:engine.height,
      stateHash:view.appHash,acceptedCount:Object.keys(engine.seen).filter(key=>!key.startsWith('nonce:')).length}}};
  // Check derived data too. Export success remains distinct from Go verification.
  // status/profile above are fixed exporter labels, not caller-supplied user
  // profile data. All variable payload fields still pass the disclosure guard.
  publicData({genesis,blocks,blockResults,replay:output.replay});
  return output;
}
