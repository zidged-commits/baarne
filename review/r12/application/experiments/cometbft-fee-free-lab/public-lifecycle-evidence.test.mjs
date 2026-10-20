import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {ownerFixture,enrollmentRecords} from './owner-enrollment-fixture.mjs';
import {LIFECYCLE_V3,createLifecycle,applyLifecycleBlock,lifecycleView} from './lifecycle-v3.mjs';
import {canonical} from './application.mjs';
import {publicLifecycleGenesis,publicLifecycleProof,parsePublicLifecycleJson} from './public-lifecycle-evidence.mjs';

async function fixture(){
  const f=await ownerFixture();
  f.config={domain:LIFECYCLE_V3,mode:'ISOLATED_SYNTHETIC_LAB',membership:f.config.membership,maxAccounts:100};
  f.records=await enrollmentRecords(f);
  return {...f,genesis:{config:f.config,bootstrap:f.records.slice(0,3)}};
}
function block(height,txs=[]){
  const id={hash:'ab'.repeat(32),parts:{total:1,hash:'cd'.repeat(32)}};
  return {block_id:structuredClone(id),block:{header:{version:{block:'11',app:'0'},
    chain_id:'BAARNE_FEE_FREE_FINALITY_LAB_V1',height:String(height),
    time:new Date((1010+height)*1000).toISOString(),last_block_id:structuredClone(id),
    last_commit_hash:'',data_hash:'',validators_hash:'',next_validators_hash:'',
    consensus_hash:'',app_hash:'',last_results_hash:'',evidence_hash:'',proposer_address:''},
    data:{txs:txs.map(tx=>Buffer.from(tx).toString('base64'))},evidence:{evidence:[]},last_commit:null}};
}
const denied=promise=>assert.rejects(promise,/NONPUBLIC_LIFECYCLE_EVIDENCE/);

test('public Genesis preserves role-bound recovery verification keys and owner signatures, without mutating the input',async()=>{
  const f=await fixture(),before=canonical(f.genesis),out=await publicLifecycleGenesis(f.genesis);
  assert.equal(canonical(out),before);assert.equal(canonical(f.genesis),before);
  for(let i=0;i<3;i++)assert.equal(out.bootstrap[i].body.recoveryKey,f.recoveryPairs[i].pub);
  const serialized=JSON.stringify(out);
  assert.equal(serialized.includes(f.seed.toString('hex')),false);
  assert.equal(serialized.includes(f.legacyKey.toString('hex')),false);
  assert.deepEqual(Object.keys(out).sort(),['bootstrap','config']);
});

test('secret/profile injection at each public boundary rejects rather than redacting a proof',async()=>{
  const f=await fixture();
  for(const target of ['root','config','membership','record','body']){
    const input=structuredClone(f.genesis);
    const object=target==='root'?input:target==='config'?input.config:target==='membership'?input.config.membership:target==='record'?input.bootstrap[0]:input.bootstrap[0].body;
    object.privateKey=f.seed.toString('hex');await denied(publicLifecycleGenesis(input));
  }
  const input=structuredClone(f.genesis);input.config.membership.notes='private profile marker';
  await denied(publicLifecycleGenesis(input));
});

test('getter, serialization hook, non-data object and sparse array are rejected without invoking hooks',async()=>{
  const f=await fixture();let invoked=false;
  const getter={...f.genesis};Object.defineProperty(getter,'privateKey',{enumerable:true,get(){invoked=true;return 'never';}});
  await denied(publicLifecycleGenesis(getter));assert.equal(invoked,false);
  const hook={...f.genesis,toJSON(){invoked=true;return f.genesis;}};
  await denied(publicLifecycleGenesis(hook));assert.equal(invoked,false);
  await denied(publicLifecycleGenesis({...f.genesis,bootstrap:f.records[0]}));
  const sparse=structuredClone(f.genesis);delete sparse.bootstrap[1];await denied(publicLifecycleGenesis(sparse));
  const keyObject={...f.genesis,privateKey:f.recoveryPairs[0].privateKey};await denied(publicLifecycleGenesis(keyObject));
});

test('swapping a public recovery key without its role possession proof cannot authorize export',async()=>{
  const f=await fixture(),input=structuredClone(f.genesis);
  input.bootstrap[0].body.recoveryKey=f.recoveryPairs[4].pub;
  await assert.rejects(publicLifecycleGenesis(input),/OWNER_NOT_PROVEN|POSSESSION_NOT_PROVEN/);
});

test('proof output preserves public block/transaction bytes and recomputes only public semantic results',async()=>{
  const f=await fixture(),raw=canonical({kind:'REGISTER',record:f.records[3]}),blocks=[block(1,[raw]),block(2)];
  const before=canonical(blocks),out=await publicLifecycleProof({genesis:f.genesis,blocks});
  assert.equal(canonical(out.blocks),before);assert.equal(canonical(blocks),before);
  const engine=await createLifecycle(f.genesis.config,f.genesis.bootstrap);
  await applyLifecycleBlock(engine,{height:1,time:1011,txs:[raw]});
  assert.equal(out.replay.info.stateHash,lifecycleView(engine).appHash);
  assert.equal(out.replay.info.acceptedCount,1);
  assert.equal(out.profile,'V3_RECONSTRUCTED_RESULTS_REQUIRE_CERTIFICATE_VERIFICATION');
  assert.equal(out.blockResults[0].txs_results[0].log,'');
  assert.equal(JSON.stringify(out).includes(f.seed.toString('hex')),false);
  // Deliberately unsigned skeleton headers exercise disclosure/semantic export,
  // not the separate Go consensus verifier. Never label this a valid certificate.
});

test('unexpected block/header metadata or diagnostic fields cannot enter the public proof',async()=>{
  const f=await fixture();
  for(const where of ['row','block','header','commit','root']){
    const input={genesis:f.genesis,blocks:[block(1),block(2)]};
    if(where==='root')input.logs='unexpected';
    else if(where==='row')input.blocks[0].operatorNotes='unexpected';
    else if(where==='block')input.blocks[0].block.privateProfile={name:'synthetic-private'};
    else if(where==='header')input.blocks[0].block.header.operatorNotes='unexpected';
    else input.blocks[0].block.last_commit={height:'0',round:0,block_id:input.blocks[0].block_id,signatures:[],notes:'unexpected'};
    await denied(publicLifecycleProof(input));
  }
});

test('private fields hidden in base64 transactions, including escaped and duplicate keys, stop export',async()=>{
  const f=await fixture();
  for(const raw of ['{"body":{"privateKey":"synthetic"}}','{"body":{"private\\u004bey":"synthetic"}}',
    '{"privateKey":"synthetic","body":{}}','{"seed":"first","seed":null}',
    '{"body":{"profile":{"label":"synthetic-private"}}}',
    JSON.stringify({kind:'EPOCH_REFERENCE',record:JSON.stringify({body:{privateKey:'synthetic'},signature:'synthetic'})}),
    JSON.stringify({kind:'RECOVER',identity:f.people[0].identity,record:JSON.stringify({secret:'synthetic'})}),
    '{"unreviewedMetadata":"arbitrary text is not a supported public intent"}']){
    await denied(publicLifecycleProof({genesis:f.genesis,blocks:[block(1,[raw]),block(2)]}));
  }
});

test('known credential strings, malformed transactions, unsupported evidence and bounds reject',async()=>{
  const f=await fixture();
  const input=structuredClone(f.genesis);input.bootstrap[0].body.nonce='gh'+'p_'+'A'.repeat(36);
  await denied(publicLifecycleGenesis(input));
  for(const mutate of [
    x=>x.blocks.splice(1),x=>x.blocks[0].block.data.txs.push('@@@='),
    x=>x.blocks[0].block.evidence.evidence.push({unexpected:'record'}),
    x=>x.blocks[0].block.data.txs.push(Buffer.from('{not json').toString('base64')),
  ]){const p={genesis:f.genesis,blocks:[block(1),block(2)]};mutate(p);await denied(publicLifecycleProof(p));}
});

test('duplicate nested JSON keys cannot erase an injected field before public validation',()=>{
  for(const raw of ['{"body":{"privateKey":"synthetic"},"body":{}}',
    '{"value":{"x":1,"\\u0078":2}}','{"privateKey":"synthetic","privateKey":null}']){
    assert.throws(()=>parsePublicLifecycleJson(raw),/NONPUBLIC_LIFECYCLE_EVIDENCE/);
  }
  assert.deepEqual(parsePublicLifecycleJson('{ "public" : [1,2] }'),{public:[1,2]});
});

test('proof CLI refuses unsafe input before creating output and refuses an existing destination',async t=>{
  const f=await fixture(),root=await mkdtemp(join(tmpdir(),'baarne-public-export-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'public-input.json'),JSON.stringify(f.genesis));
  const unsafe=[block(1),block(2)];unsafe[0].block.header.privateKey='synthetic';
  await writeFile(join(root,'public-blocks.json'),JSON.stringify(unsafe));
  const output=join(root,'new-output.json'),cli=resolve('scripts/prepare-lifecycle-proof.mjs');
  const execute=()=>spawnSync(process.execPath,[cli,root,output],{encoding:'utf8',windowsHide:true});
  assert.notEqual(execute().status,0);await assert.rejects(readFile(output),{code:'ENOENT'});
  await writeFile(join(root,'public-blocks.json'),JSON.stringify([block(1),block(2)]));
  assert.equal(execute().status,0);const saved=await readFile(output);
  assert.notEqual(execute().status,0);assert.deepEqual(await readFile(output),saved);
});

test('fixture signer initial stdout contains only the reviewed public input and declared identity metadata',()=>{
  const child=spawnSync(process.execPath,['experiments/cometbft-fee-free-lab/lifecycle-vectors.mjs','1000'],
    {input:'',encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(child.status,0,child.stderr);const out=JSON.parse(child.stdout.trim());
  assert.deepEqual(Object.keys(out).sort(),['bootstrap','config','eventCount','people']);
  assert.equal(out.bootstrap.length,3);assert.equal(out.people.length,5);
  assert.equal(/"(?:privateKey|seed|legacyKey|wallet)"/.test(child.stdout),false);
});
