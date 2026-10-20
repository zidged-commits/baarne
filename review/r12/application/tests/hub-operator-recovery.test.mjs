import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,copyFile,lstat,statfs} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';
import {provisionHubOperator,runHubOperator,inspectHubOperator} from '../apps/hub/operator-provider.mjs';
import {PrivateHubClient} from '../apps/hub/public/private-client.mjs';
import {createBrowserOwner} from '../apps/hub/public/private-protocol.mjs';
import * as d from '../packages/behavioral-twin/src/index.mjs';import {projectIntroductionProfile} from '../packages/behavioral-twin/src/handoff-projection.mjs';
const MODE='ISOLATED_SYNTHETIC_LAB',fixtureScript=resolve('tests/fixtures/hub-recovery-child.mjs');
const applied=async promise=>{const result=await promise;assert.equal(result.status,'APPLIED',result.reason);return result;};
async function fixture(t,storagePolicy){
  const root=await mkdtemp(join(tmpdir(),'baarne-k6-recovery-')),providerDirectory=join(root,'provider'),workspace=join(root,'workspace'),children=[],apps=[],owners=[],locals=[];
  t.after(async()=>{for(const c of children){if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL');await c.done;}for(const app of apps)await app.stop().catch(()=>{});for(const o of owners)o.lock();assert(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/'));await rm(root,{recursive:true,force:true,maxRetries:30,retryDelay:100});});
  const initial=await provisionHubOperator({mode:MODE,providerDirectory,workspace,storagePolicy}),options=state=>({mode:MODE,providerDirectory,providerPin:state.providerPin,controlPin:state.controlPin});
  function launch(state,cutAt='',recover=false){
    const child=spawn(process.execPath,[fixtureScript,providerDirectory,state.providerPin,state.controlPin,cutAt,recover?'recover':'run'],{stdio:['pipe','pipe','pipe'],windowsHide:true});child.done=new Promise(ok=>child.once('close',ok));children.push(child);
    const events=[],waiters=[];let errors='';child.stderr.on('data',b=>{errors+=b;});createInterface({input:child.stdout}).on('line',line=>{const v=JSON.parse(line),i=waiters.findIndex(w=>w.name===v.event||v.event==='ERROR');if(i>=0){const w=waiters.splice(i,1)[0];clearTimeout(w.timer);v.event==='ERROR'?w.no(Error(v.error)):w.ok(v);}else events.push(v);});
    child.once('exit',()=>{for(const w of waiters.splice(0)){clearTimeout(w.timer);w.no(Error('RECOVERY_CHILD_EXITED '+errors));}});
    const event=name=>new Promise((ok,no)=>{const i=events.findIndex(v=>v.event===name||v.event==='ERROR');if(i>=0){const v=events.splice(i,1)[0];return v.event==='ERROR'?no(Error(v.error)):ok(v);}const w={name,ok,no,timer:setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);no(Error('RECOVERY_CHILD_TIMEOUT '+name));},20000)};waiters.push(w);});
    return {child,event,send:line=>child.stdin.write(line+'\n'),kill:async()=>{child.kill('SIGKILL');await child.done;}};
  }
  async function client(url,i,enroll=false){
    if(!owners[i]){owners[i]=await createBrowserOwner('synthetic crash fixture owner only');const rows=new Map();locals[i]={get:async k=>rows.get(k)??null,put:async(k,v)=>rows.set(k,v),remove:async k=>rows.delete(k)};}
    const c=new PrivateHubClient({owner:owners[i],url,fetch:(u,v)=>fetch(u,{...v,headers:{...v.headers,Origin:url}}),storage:locals[i],projectIntroductionProfile,fields:d.DISCOVERY_FIELDS});await c.attach({enroll});return c;
  }
  function profile(i,now=10){let p=d.createTwinProfile({userId:'synthetic:user-0'+(i+1),displayLabel:'SECRET_CRASH_PROFILE_'+now,now:0});for(const [questionId,values] of [['skill-technical',[i?'solar-installation':'sensor-engineering']],['need-build',[i?'sensor-monitoring':'solar-expertise']],['goal-near',['launch-pilot']]])p=d.answerOnboardingQuestion(p,{questionId,values,useForDiscovery:true,now});for(const purpose of ['discovery','introduction'])for(const field of ['skillsOffered','needs','goals'])p=d.setFieldPermission(p,{purpose,field,allowed:true,now});return d.setDiscoveryEnabled(p,{enabled:true,now});}
  return {root,workspace,providerDirectory,initial,options,launch,client,profile,apps};
}

for(const stage of ['beforeNativeMutation','afterNativeMutation','afterCheckpoint'])test('pinned recovery across real kill at '+stage+' reconciles exactly once',async t=>{
  const f=await fixture(t),runner=f.launch(f.initial,stage),ready=await runner.event('READY'),c=await f.client(ready.url,0,true);
  runner.send('arm');await runner.event('ARMED');const pending=c.vaultCommand('PROFILE',f.profile(0));const cut=await runner.event('CUT');await runner.kill();assert.equal((await pending).status,'UNKNOWN');
  const recovery=f.launch(cut,'',true),again=await recovery.event('READY'),restored=await f.client(again.url,0);assert.equal(restored.pending(),true);
  const receipt=await restored.reconcile();if(stage==='beforeNativeMutation'){assert.equal(receipt.status,'NOT_APPLIED');await applied(restored.retryPending());}else assert.equal(receipt.status,'APPLIED');
  assert.equal((await restored.exportProfile()).displayLabel,'SECRET_CRASH_PROFILE_10');assert.equal((await restored.refresh()).vaultHead.revision,1);recovery.send('stop');await recovery.event('STOPPED');assert.equal(await recovery.child.done,0);
});

test('withdrawal survives crash before checkpoint; old bilateral disclosure is not resurrected',async t=>{
  const f=await fixture(t),r=f.launch(f.initial,'afterNativeMutation'),ready=await r.event('READY'),a=await f.client(ready.url,0,true),b=await f.client(ready.url,1,true);
  for(const [i,c] of [a,b].entries()){await applied(c.updateProfile(f.profile(i)));await applied(c.enableDiscovery(['skillsOffered','needs','goals'],Math.floor(Date.now()/1000)+3600));}
  for(const c of [a,b])await applied(c.pairAction('INTEREST'));for(const c of [a,b])await applied(c.pairAction('APPROVE',{fields:['skillsOffered']}));assert(Object.keys((await b.readPair()).disclosures).length>0);
  r.send('arm');await r.event('ARMED');const pending=a.pairAction('WITHDRAW'),cut=await r.event('CUT');await r.kill();assert.equal((await pending).status,'UNKNOWN');
  const recovered=f.launch(cut,'',true),again=await recovered.event('READY'),peer=await f.client(again.url,1);assert.deepEqual((await peer.readPair()).disclosures,{});assert.equal((await peer.readPair()).state,'WITHDRAWN');const owner=await f.client(again.url,0);await applied(owner.reconcile());recovered.send('stop');await recovered.event('STOPPED');
});

test('unexpected native tail and wrong external recovery pin never start a listener',async t=>{
  const f=await fixture(t),r=f.launch(f.initial,'beforeNativeMutation'),ready=await r.event('READY'),c=await f.client(ready.url,0,true);r.send('arm');await r.event('ARMED');const pending=c.vaultCommand('PROFILE',f.profile(0)),cut=await r.event('CUT');await r.kill();await pending;
  await assert.rejects(runHubOperator({...f.options(cut),controlPin:'00'.repeat(32),recover:true}),/CONTROL_PIN/);
  await copyFile(join(f.workspace,'01','snapshot-0000.json'),join(f.workspace,'01','snapshot-0001.json'));
  const recovered=f.launch(cut,'',true);await assert.rejects(recovered.event('READY'));assert.equal(await recovered.child.done,1);assert.equal((await inspectHubOperator(f.options(cut))).state,'RUNNING');
});

test('unacknowledged partial enrollment fails unavailable rather than inventing lost service keys',async t=>{
  const f=await fixture(t),r=f.launch(f.initial,'afterNativeMutation'),ready=await r.event('READY');r.send('arm');await r.event('ARMED');const enrolling=f.client(ready.url,0,true).then(()=>null,error=>error),cut=await r.event('CUT');await r.kill();assert(await enrolling);
  const recovered=f.launch(cut,'',true);await assert.rejects(recovered.event('READY'),/UNEXPECTED_OPERATOR_ENTRY/);assert.equal(await recovered.child.done,1);
});

test('configured vault quota halts writes, retains signed export and persists halt across clean restart',async t=>{
  const f=await fixture(t,{maxVaultRevision:1,minFreeBytes:1024*1024}),app=await runHubOperator(f.options(f.initial));f.apps.push(app);const c=await f.client(app.url,0,true);await applied(c.updateProfile(f.profile(0)));
  assert.equal((await c.vaultCommand('PROFILE',f.profile(0,20))).status,'UNKNOWN');assert.equal(app.health().hub.writeStopReason,'VAULT_QUOTA');assert.deepEqual(app.health().storage.vaultRevisions,[1]);assert.equal(app.health().storage.pendingMutation,false);assert.equal((await c.exportProfile()).displayLabel,'SECRET_CRASH_PROFILE_10');assert.equal((await c.refresh()).vaultHead.revision,1);
  const closed=await app.stop(),next=await runHubOperator(f.options(closed));f.apps.push(next);assert.equal(next.health().hub.writeStopReason,'VAULT_QUOTA');const restored=await f.client(next.url,0);assert.equal((await restored.exportProfile()).displayLabel,'SECRET_CRASH_PROFILE_10');
});

test('real filesystem reserve measurement denies mutation before native state changes',async t=>{
  const disk=await statfs(tmpdir()),f=await fixture(t,{maxVaultRevision:1000,minFreeBytes:Math.min(2**50,Math.ceil(disk.blocks*disk.bsize)+1024*1024)}),app=await runHubOperator(f.options(f.initial));f.apps.push(app);
  await assert.rejects(f.client(app.url,0,true),/REJECTED/);assert.equal(app.health().hub.writeStopReason,'DISK_RESERVE_HALT');assert.equal(app.health().hub.participants,0);await assert.rejects(lstat(join(f.workspace,'01')),{code:'ENOENT'});
});

test('injected ENOSPC after native mutation stays UNKNOWN and explicit recovery validates the one signed tail',async t=>{
  const f=await fixture(t);let armed=false,last;const app=await runHubOperator({...f.options(f.initial),onDurableState:state=>{last=state;},faultHook:async step=>{if(armed&&step==='afterNativeMutation')throw Object.assign(Error('SYNTHETIC_ENOSPC'),{code:'ENOSPC'});}});f.apps.push(app);
  const c=await f.client(app.url,0,true);armed=true;assert.equal((await c.vaultCommand('PROFILE',f.profile(0))).status,'UNKNOWN');assert.equal(app.health().hub.state,'FAULTED');await assert.rejects(app.stop(),/UNCERTAIN_STORE/);
  const recovered=await runHubOperator({...f.options(last),recover:true});f.apps.push(recovered);const owner=await f.client(recovered.url,0);await applied(owner.reconcile());assert.equal((await owner.refresh()).vaultHead.revision,1);
  const raw=await readFile(join(f.workspace,'operator-checkpoint.json'),'utf8');assert(!raw.includes('SECRET_CRASH_PROFILE'));await assert.rejects(lstat(join(f.workspace,'operator-intent.json')),{code:'ENOENT'});
});

for(const action of ['DELETE','BLOCK','HANDOFF'])test('recovery rebuilds the privacy cache after '+action+' without stale disclosure',async t=>{
  const f=await fixture(t),r=f.launch(f.initial,'afterNativeMutation'),ready=await r.event('READY'),a=await f.client(ready.url,0,true),b=await f.client(ready.url,1,true);
  for(const [i,c] of [a,b].entries()){await applied(c.updateProfile(f.profile(i)));await applied(c.enableDiscovery(['skillsOffered','needs','goals'],Math.floor(Date.now()/1000)+3600));}
  for(const c of [a,b])await applied(c.pairAction('INTEREST'));for(const c of [a,b])await applied(c.pairAction('APPROVE',{fields:['skillsOffered']}));
  if(action==='HANDOFF')await applied(a.vaultCommand('PROFILE',f.profile(0,20)));
  r.send('arm');await r.event('ARMED');const pending=action==='DELETE'?a.vaultCommand('DELETE',{}):action==='BLOCK'?a.pairAction('BLOCK'):a.syncSource(),cut=await r.event('CUT');await r.kill();assert.equal((await pending).status,'UNKNOWN');
  const rr=f.launch(cut,'',true),again=await rr.event('READY'),owner=await f.client(again.url,0),peer=await f.client(again.url,1);await applied(owner.reconcile());
  if(action==='DELETE'){await assert.rejects(peer.readPair(),/SOURCE_SYNC_REQUIRED/);await assert.rejects(owner.exportProfile(),/REJECTED/);await applied(owner.sourceNotice('DELETE',20));assert.deepEqual((await peer.readPair()).disclosures,{});}
  if(action==='BLOCK'){assert.equal((await peer.readPair()).state,'BLOCKED');assert.deepEqual(await peer.discover(),[]);}
  if(action==='HANDOFF'){assert.equal(owner.context().needsSourceSync,false);await peer.readPair();assert.equal((await owner.exportProfile()).displayLabel,'SECRET_CRASH_PROFILE_20');}
  rr.send('stop');await rr.event('STOPPED');
});

test('explicit pinned recovery clears only an incomplete cache temporary after native replay',async t=>{
  const f=await fixture(t),app=await runHubOperator(f.options(f.initial));f.apps.push(app);const state=app.health();await writeFile(join(f.workspace,'operator-checkpoint.pending'),'synthetic incomplete cache write',{flag:'wx'});await assert.rejects(app.stop(),{code:'EEXIST'});
  const recovered=await runHubOperator({...f.options(state),recover:true});f.apps.push(recovered);assert.equal(recovered.health().hub.state,'RUNNING');await assert.rejects(lstat(join(f.workspace,'operator-checkpoint.pending')),{code:'ENOENT'});
});

test('corrupt encrypted recovery intent cannot authorize a restart',async t=>{
  const f=await fixture(t),r=f.launch(f.initial,'beforeNativeMutation'),ready=await r.event('READY'),c=await f.client(ready.url,0,true);r.send('arm');await r.event('ARMED');const pending=c.vaultCommand('PROFILE',f.profile(0)),cut=await r.event('CUT');await r.kill();await pending;
  await writeFile(join(f.workspace,'operator-intent.json'),'{}');const rr=f.launch(cut,'',true);await assert.rejects(rr.event('READY'),/PIN_MISMATCH/);assert.equal(await rr.child.done,1);
});
