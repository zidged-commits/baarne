import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,readFile,copyFile,mkdir,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LifecycleJournal} from '../experiments/cometbft-fee-free-lab/lifecycle-journal.mjs';
import {LifecycleAbci} from '../experiments/cometbft-fee-free-lab/lifecycle-abci.mjs';
import {canonical,digest} from '../experiments/cometbft-fee-free-lab/application.mjs';
const signer=fileURLToPath(new URL('./fixtures/k4-lifecycle-vectors.mjs',import.meta.url));
const worker=fileURLToPath(new URL('../experiments/cometbft-fee-free-lab/lifecycle-worker.mjs',import.meta.url));
function fixture(network='baarne:fee-free-membership-lab',commands=[{kind:'event',index:0}]){
  const rows=execFileSync(process.execPath,[signer,'1000',network],{
    input:commands.map(x=>JSON.stringify(x)+'\n').join(''),encoding:'utf8',timeout:20000,
    maxBuffer:512*1024}).trim().split('\n').map(x=>JSON.parse(x));
  for(const row of rows.slice(1))assert.equal(row.ok,true);
  return {input:{config:rows[0].config,bootstrap:rows[0].bootstrap},txs:rows.slice(1).map(x=>x.tx)};
}
test('selected V3 fresh Genesis has disjoint identities, rejects old intent/store and preserves prior history',async t=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-k4-genesis-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const previous=fixture(),fresh=fixture('baarne:k4-new-synthetic-network');
  const old=await LifecycleJournal.create(join(root,'old'),previous.input.config,previous.input.bootstrap);
  await old.append({height:1,time:1010,txs:previous.txs});const pin=old.pin();
  const before=await readFile(join(root,'old','block-0001.json'));
  const next=await LifecycleAbci.create(join(root,'fresh'),fresh.input);
  assert.equal(next.info().height,0);assert.equal(next.info().acceptedCount,0);
  assert.notEqual(digest(previous.input.config),digest(fresh.input.config));
  assert(previous.input.config.membership.founders.every(x=>!fresh.input.config.membership.founders.includes(x)));
  assert.equal((await next.checkIntent(previous.txs[0])).code,1);
  await assert.rejects(LifecycleJournal.load(join(root,'old'),fresh.input.config,fresh.input.bootstrap,pin),/WRONG_JOURNAL_SCOPE/);
  await assert.rejects(LifecycleJournal.create(join(root,'old'),fresh.input.config,fresh.input.bootstrap),/EEXIST/);
  assert.deepEqual(await readFile(join(root,'old','block-0001.json')),before);
  assert.deepEqual((await LifecycleJournal.load(join(root,'old'),previous.input.config,previous.input.bootstrap,pin)).pin(),pin);
});
test('actual lifecycle worker uses correlated frames through commit/restart with duplicate-safe effects',async t=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-k4-worker-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const f=fixture(),genesis=join(root,'public-genesis.json'),store=join(root,'store');
  await writeFile(genesis,canonical(f.input));
  execFileSync(process.execPath,[worker,store,genesis,'initialize'],{timeout:10000});
  const run=requests=>execFileSync(process.execPath,[worker,store,genesis],{timeout:15000,maxBuffer:512*1024,encoding:'utf8',
    input:requests.map((request,i)=>canonical({id:i+1,request})+'\n').join('')}).trim().split('\n').map(JSON.parse);
  const first=run([{method:'info'},{method:'finalize',height:1,time:1010,txs:null},{method:'commit'},
    {method:'check',tx:Buffer.from(f.txs[0]).toString('base64')},
    {method:'finalize',height:2,time:1011,txs:f.txs.map(x=>Buffer.from(x).toString('base64'))},{method:'commit'},{method:'query'}]);
  assert.deepEqual(first.map(x=>x.id),[1,2,3,4,5,6,7]);assert(first.every(x=>x.response.ok));
  assert.equal(first[0].response.result.height,0);assert.equal(first[2].response.result.acceptedCount,0);
  assert.equal(first[5].response.result.acceptedCount,1);assert.equal(first[6].response.result.info.height,2);
  const second=run([{method:'info'},{method:'finalize',height:3,time:1012,txs:f.txs.map(x=>Buffer.from(x).toString('base64'))},{method:'commit'}]);
  assert.equal(second[0].response.result.height,2);assert.equal(second[2].response.result.acceptedCount,1);
});
test('actual lifecycle worker rejects unframed/ambiguous/invalid request input without a success response',async t=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-k4-worker-reject-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const f=fixture(),genesis=join(root,'public-genesis.json'),store=join(root,'store');
  await writeFile(genesis,canonical(f.input));execFileSync(process.execPath,[worker,store,genesis,'initialize'],{timeout:10000});
  for(const input of ['{"method":"info"}', '{"id":1,"id":2,"request":{"method":"info"}}',
    canonical({id:1,request:{method:'info',extra:true}}),canonical({id:1,request:{method:'check',tx:'%%bad%%'}}),'a'.repeat(262209)]){
    assert.throws(()=>execFileSync(process.execPath,[worker,store,genesis],{input:input+'\n',timeout:10000,encoding:'utf8',stdio:['pipe','pipe','pipe']}),error=>{
      assert.equal(error.status,1);assert.equal(error.stdout,'');assert.match(error.stderr,/INVALID_IPC_FRAME|IPC_FRAME_TOO_LARGE/);return true;
    });
  }
});
test('lifecycle worker requires bounded canonical Genesis before creating state',async t=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-k4-worker-genesis-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const f=fixture(),genesis=join(root,'public-genesis.json'),store=join(root,'store');
  await writeFile(genesis,JSON.stringify(f.input,null,2));
  assert.throws(()=>execFileSync(process.execPath,[worker,store,genesis,'initialize'],{timeout:10000,stdio:['pipe','pipe','pipe']}),error=>{
    assert.equal(error.status,1);assert.match(error.stderr.toString(),/NONCANONICAL_GENESIS/);return true;
  });
  await assert.rejects(access(store));
});
test('selected V3 durable reopen and identical signed retry retain one effect; unavailable/corrupt journal is not history',async t=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-k4-reopen-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const f=fixture(),old=await LifecycleJournal.create(join(root,'old'),f.input.config,f.input.bootstrap);
  const first=await old.append({height:1,time:1010,txs:f.txs});assert.notEqual(first.results[0].status,'REJECTED');
  const pin=old.pin();await mkdir(join(root,'survivor'));
  for(const name of ['metadata.json','block-0001.json'])await copyFile(join(root,'old',name),join(root,'survivor',name));
  const restored=await LifecycleJournal.load(join(root,'survivor'),f.input.config,f.input.bootstrap,pin);
  assert.equal(restored.view().appHash,old.view().appHash);
  const second=await restored.append({height:2,time:1011,txs:f.txs});assert.equal(second.results[0].status,'DUPLICATE');
  assert.equal(Object.keys(restored.view().document.seen).filter(x=>!x.startsWith('nonce:')).length,1);
  await assert.rejects(LifecycleJournal.load(join(root,'absent'),f.input.config,f.input.bootstrap,pin));
  await rm(join(root,'old','block-0001.json'));
  await assert.rejects(LifecycleJournal.load(join(root,'old'),f.input.config,f.input.bootstrap,pin));
  await writeFile(join(root,'old','block-0001.json'),'{"broken":true}');
  await assert.rejects(LifecycleJournal.load(join(root,'old'),f.input.config,f.input.bootstrap,pin));
  // Local journal pins authenticate integrity only; consensus certificate is a separate K4 check.
});
