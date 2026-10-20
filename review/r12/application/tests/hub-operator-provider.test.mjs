import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,lstat,readdir,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {createInterface} from 'node:readline';
import {provisionHubOperator,runHubOperator,inspectHubOperator,backupHubOperator,restoreHubOperator} from '../apps/hub/operator-provider.mjs';
import {PrivateHubClient} from '../apps/hub/public/private-client.mjs';
import {createBrowserOwner} from '../apps/hub/public/private-protocol.mjs';
import {createTwinProfile,DISCOVERY_FIELDS} from '../packages/behavioral-twin/src/index.mjs';
import {projectIntroductionProfile} from '../packages/behavioral-twin/src/handoff-projection.mjs';
const MODE='ISOLATED_SYNTHETIC_LAB',CLI=resolve('apps/hub/operator-cli.mjs'),execute=promisify(execFile),sha=raw=>createHash('sha256').update(raw).digest('hex');
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'baarne-k6-provider-')),providerDirectory=join(root,'provider'),workspace=join(root,'workspace'),children=[],apps=[],owners=[];
  t.after(async()=>{for(const app of apps)await app.stop().catch(()=>{});for(const child of children){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await child.done;}for(const o of owners)o.lock();assert(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/'));await rm(root,{recursive:true,force:true,maxRetries:30,retryDelay:100});});
  const options=s=>({mode:MODE,providerDirectory,providerPin:s.providerPin,controlPin:s.controlPin});
  async function init(){return provisionHubOperator({mode:MODE,providerDirectory,workspace});}
  async function cli(...args){const r=await execute(process.execPath,[CLI,...args],{windowsHide:true,timeout:30000,maxBuffer:131072});return JSON.parse(r.stdout.trim());}
  function launch(s){
    const child=spawn(process.execPath,[CLI,'run',MODE,providerDirectory,s.providerPin,s.controlPin],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    child.done=new Promise(ok=>child.once('close',ok));children.push(child);const events=[],waiters=[];let stderr='';
    child.stderr.on('data',raw=>{stderr+=raw;});const lines=createInterface({input:child.stdout});
    lines.on('line',raw=>{const value=JSON.parse(raw);const i=waiters.findIndex(w=>w.name===value.event||value.error);if(i>=0){const w=waiters.splice(i,1)[0];clearTimeout(w.timer);value.error?w.no(Error(value.error)):w.ok(value);}else events.push(value);});
    child.once('exit',()=>{for(const w of waiters.splice(0)){clearTimeout(w.timer);w.no(Error('CHILD_EXITED '+stderr));}});
    const event=name=>new Promise((ok,no)=>{const i=events.findIndex(v=>v.event===name||v.error);if(i>=0){const v=events.splice(i,1)[0];return v.error?no(Error(v.error)):ok(v);}const w={name,ok,no,timer:setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);no(Error('OPERATOR_CHILD_EVENT_TIMEOUT '+name));},20000)};waiters.push(w);});
    return {child,event,send:line=>child.stdin.write(line+'\n')};
  }
  async function ownerClient(url,{enroll=false,owner}={}){
    if(!owner){owner=await createBrowserOwner('synthetic provider owner, not a real credential');owners.push(owner);}
    const rows=new Map(),c=new PrivateHubClient({url,owner,fetch:(u,i)=>fetch(u,{...i,headers:{...i.headers,Origin:url}}),storage:{get:async k=>rows.get(k)??null,put:async(k,v)=>rows.set(k,v),remove:async k=>rows.delete(k)},projectIntroductionProfile,fields:DISCOVERY_FIELDS});await c.attach({enroll});return {client:c,owner};
  }
  return {root,providerDirectory,workspace,options,init,cli,launch,ownerClient,apps};
}

test('separate CLI processes provision and reopen DPAPI-backed synthetic Hub without raw keys in arguments/output',async t=>{
  const f=await fixture(t),init=await f.cli('init',MODE,f.providerDirectory,f.workspace);assert.equal(init.state,'CLEAN');assert.equal(init.sequence,0);assert.equal(init.productionAuthorized,false);
  assert(!JSON.stringify(init).includes('protected'));assert(!JSON.stringify(init).includes('operatorKey'));
  const first=f.launch(init),ready=await first.event('READY');assert.equal(ready.state,'RUNNING');assert.equal(ready.hub.durableCheckpoint,true);
  const {client,owner}=await f.ownerClient(ready.url,{enroll:true}),profile=createTwinProfile({userId:client.context().actorId,displayLabel:'PRIVATE_DPAPI_RESTART_PROFILE',now:0});assert.equal((await client.updateProfile(profile)).status,'APPLIED');const before=await client.refresh();
  first.send('health');assert.equal((await first.event('HEALTH')).hub.participants,1);first.send('stop');const closed=await first.event('STOPPED');assert.equal(await first.child.done,0);assert.equal(closed.state,'CLEAN');
  const second=f.launch(closed),again=await second.event('READY');assert.equal(again.url,ready.url);const restored=await f.ownerClient(again.url,{owner});assert.deepEqual(restored.client.context(),before);assert.equal((await restored.client.exportProfile()).displayLabel,profile.displayLabel);
  second.send('not-a-command');await assert.rejects(second.event('HEALTH'),/OPERATOR_COMMAND_REQUIRED/);second.send('stop');const final=await second.event('STOPPED');assert.equal(await second.child.done,0);
  const status=await f.cli('status',MODE,f.providerDirectory,final.providerPin,final.controlPin);assert.equal(status.event,'STATUS');assert.equal(status.state,'CLEAN');
  const protectedFile=await readFile(join(f.providerDirectory,'provider.json'),'utf8');assert(!protectedFile.includes(profile.displayLabel));assert(protectedFile.includes('protected'));assert(!protectedFile.includes('PRIVATE KEY'));
});

test('wrong pins and re-pinned tampered control are rejected without regenerated keys or fallback',async t=>{
  const f=await fixture(t),state=await f.init(),opts=f.options(state);
  await assert.rejects(inspectHubOperator({...opts,providerPin:'00'.repeat(32)}),/PROVIDER_PIN/);await assert.rejects(inspectHubOperator({...opts,controlPin:'00'.repeat(32)}),/CONTROL_PIN/);
  const path=join(f.providerDirectory,'control.json'),raw=await readFile(path),body=JSON.parse(raw);body.body.sequence=44;
  const tampered=JSON.stringify(body,null,2);await writeFile(path,tampered);await assert.rejects(inspectHubOperator({...opts,controlPin:sha(tampered)}),/INVALID_OPERATOR_CONTROL/);
  const {canonical}=await import('../experiments/cometbft-fee-free-lab/application.mjs'),canonicalTamper=canonical(body);await writeFile(path,canonicalTamper);await assert.rejects(inspectHubOperator({...opts,controlPin:sha(canonicalTamper)}),/AUTHENTICATION/);
  await writeFile(path,raw);assert.equal((await inspectHubOperator(opts)).state,'CLEAN');
});

test('corrupt protected provider and missing key material fail unavailable; initialization never overwrites',async t=>{
  const f=await fixture(t),state=await f.init(),opts=f.options(state),path=join(f.providerDirectory,'provider.json'),raw=await readFile(path),row=JSON.parse(raw);
  const {canonical}=await import('../experiments/cometbft-fee-free-lab/application.mjs');row.protected='AAAA';const changed=canonical(row);await writeFile(path,changed);await assert.rejects(inspectHubOperator({...opts,providerPin:sha(changed)}),/DPAPI/);
  await unlink(path);await assert.rejects(inspectHubOperator(opts),/INVALID_OPERATOR_PROVIDER/);await writeFile(path,raw);
  await assert.rejects(f.init(),/TARGET_EXISTS/);assert.deepEqual(await readFile(path),raw);assert.equal((await inspectHubOperator(opts)).state,'CLEAN');
});

test('operator-owned backup omits provider; restore rebinds only to a new target and requires native replay before backup',async t=>{
  const f=await fixture(t),initial=await f.init(),app=await runHubOperator(f.options(initial));f.apps.push(app);
  const {client,owner}=await f.ownerClient(app.url,{enroll:true});const profile=createTwinProfile({userId:client.context().actorId,displayLabel:'PRIVATE_PROVIDER_BACKUP_PROFILE',now:0});await client.updateProfile(profile);const closed=await app.stop();
  const original=await readFile(join(f.workspace,'operator-checkpoint.json')),backupDirectory=join(f.root,'backup');const backup=await backupHubOperator({...f.options(closed),target:backupDirectory});
  assert(!(await readdir(backupDirectory)).includes('provider.json'));assert.equal((await inspectHubOperator(f.options(closed))).controlPin,closed.controlPin);
  const target=join(f.root,'replacement'),restored=await restoreHubOperator({...f.options(closed),backupDirectory,backupPin:backup.backupPin,target});assert.equal(restored.state,'RESTORED_UNVERIFIED');assert.equal(restored.restoreState,'COPIED_NOT_REPLAY_VERIFIED');
  await assert.rejects(backupHubOperator({...f.options(restored),target:join(f.root,'unverified-backup')}),/NATIVE_REPLAY_REQUIRED/);
  const replacement=await runHubOperator(f.options(restored));f.apps.push(replacement);const c=await f.ownerClient(replacement.url,{owner});assert.equal((await c.client.exportProfile()).displayLabel,profile.displayLabel);assert.equal((await replacement.stop()).state,'CLEAN');assert.deepEqual(await readFile(join(f.workspace,'operator-checkpoint.json')),original);
});

test('real killed runner leaves RUNNING control and cannot be restarted or backed up as clean',async t=>{
  const f=await fixture(t),state=await f.init(),runner=f.launch(state),ready=await runner.event('READY');
  await assert.rejects(inspectHubOperator(f.options(ready)),/OWNED|LOCK/);runner.child.kill('SIGKILL');await runner.child.done;
  const status=await inspectHubOperator(f.options(ready));assert.equal(status.state,'RUNNING');
  await assert.rejects(runHubOperator(f.options(ready)),/UNCLEAN_STATE/);const target=join(f.root,'not-clean-backup');await assert.rejects(backupHubOperator({...f.options(ready),target}),/UNCLEAN_STATE/);await assert.rejects(lstat(target),{code:'ENOENT'});
});

test('external control publication failure never prints a successful clean stop',async t=>{
  const f=await fixture(t),state=await f.init(),runner=f.launch(state),ready=await runner.event('READY');
  await writeFile(join(f.providerDirectory,'control.pending'),'synthetic blocked control publication',{flag:'wx'});runner.send('stop');await assert.rejects(runner.event('STOPPED'),/EEXIST/);assert.equal(await runner.child.done,1);
  await assert.rejects(inspectHubOperator(f.options(ready)),/PENDING_ENTRY/);
});

test('production mode, nested provider/workspace and source overwrite are rejected before provisioning',async t=>{
  const f=await fixture(t);
  await assert.rejects(provisionHubOperator({mode:'PRODUCTION',providerDirectory:f.providerDirectory,workspace:f.workspace}),/EXPLICIT_SYNTHETIC/);await assert.rejects(lstat(f.providerDirectory),{code:'ENOENT'});
  await assert.rejects(provisionHubOperator({mode:MODE,providerDirectory:f.providerDirectory,workspace:join(f.providerDirectory,'inside')}),/MUST_BE_SEPARATE/);await assert.rejects(lstat(f.providerDirectory),{code:'ENOENT'});
  const initial=await f.init(),before=await readFile(join(f.providerDirectory,'provider.json'));await assert.rejects(provisionHubOperator({mode:MODE,providerDirectory:join(f.root,'unused'),workspace:f.workspace}),/TARGET_EXISTS/);await assert.rejects(lstat(join(f.root,'unused')),{code:'ENOENT'});assert.deepEqual(await readFile(join(f.providerDirectory,'provider.json')),before);assert.equal((await inspectHubOperator(f.options(initial))).state,'CLEAN');
});

test('failed restore remains explicitly incomplete and never authorizes falling back to the old workspace',async t=>{
  const f=await fixture(t),state=await f.init(),backupDirectory=join(f.root,'backup');await backupHubOperator({...f.options(state),target:backupDirectory});
  const target=join(f.root,'not-created');await assert.rejects(restoreHubOperator({...f.options(state),backupDirectory,backupPin:'00'.repeat(32),target}),/BACKUP_PIN_MISMATCH/);await assert.rejects(lstat(target),{code:'ENOENT'});
  // The newly published control is public test metadata. Reading its hash is an
  // observation for this assertion, not a production freshness/approval source.
  const raw=await readFile(join(f.providerDirectory,'control.json')),observed={...state,controlPin:sha(raw)};assert.equal((await inspectHubOperator(f.options(observed))).state,'COPYING_RESTORE');await assert.rejects(runHubOperator(f.options(observed)),/UNCLEAN_STATE/);
  await assert.rejects(inspectHubOperator(f.options(state)),/CONTROL_PIN_MISMATCH/);
});
