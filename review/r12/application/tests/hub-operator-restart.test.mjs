import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile,readdir,lstat,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {startPrivateHub} from '../apps/hub/private-server.mjs';
import {backupClosedHub,restoreClosedHub} from '../apps/hub/operator-backup.mjs';
import {operatorCheckpoint} from '../apps/hub/operator-checkpoint.mjs';
import {PrivateHubClient} from '../apps/hub/public/private-client.mjs';
import {createBrowserOwner,HUB_PRIVATE_VERSION,canonical,hash,hubMessage} from '../apps/hub/public/private-protocol.mjs';
import {projectIntroductionProfile} from '../packages/behavioral-twin/src/handoff-projection.mjs';
import * as d from '../packages/behavioral-twin/src/index.mjs';
const MODE='ISOLATED_SYNTHETIC_LAB',PASSWORD='synthetic operator restart owners only';
const applied=async p=>{const r=await p;assert.equal(r.status,'APPLIED',r.reason);return r;};
function storage(){const rows=new Map();return {get:async k=>rows.get(k)??null,put:async(k,v)=>rows.set(k,v),remove:async k=>rows.delete(k)};}
async function fixture(t,count=2){
  const root=await mkdtemp(join(tmpdir(),'baarne-k6-')),directory=join(root,'workspace'),operatorKey=randomBytes(32),owners=[],locals=[];
  let app=await startPrivateHub({directory,mode:MODE,operatorKey,clock:()=>1000}),checkpoint;
  t.after(async()=>{await app.close().catch(()=>{});for(const o of owners)o.lock();operatorKey.fill(0);assert(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/'));await rm(root,{recursive:true,force:true});});
  function client(i,transport=(url,init)=>fetch(url,{...init,headers:{...init.headers,Origin:app.url}})){return new PrivateHubClient({owner:owners[i],url:app.url,storage:locals[i],fetch:transport,projectIntroductionProfile,fields:d.DISCOVERY_FIELDS});}
  for(let i=0;i<count;i++){owners.push(await createBrowserOwner(PASSWORD));locals.push(storage());await client(i).attach({enroll:true});}
  async function stop(){checkpoint=await app.close();assert.equal(checkpoint.state,'CLEANLY_CLOSED');return checkpoint;}
  async function resume(pin=checkpoint.checkpointPin){app=await startPrivateHub({directory,mode:MODE,operatorKey,resumePin:pin,clock:()=>1000});return app;}
  function profile(i){let p=d.createTwinProfile({userId:'synthetic:user-0'+(i+1),displayLabel:'SECRET_K6_PROFILE_'+i,now:0});for(const [questionId,values] of [['skill-technical',[i?'solar-installation':'sensor-engineering']],['need-build',[i?'sensor-monitoring':'solar-expertise']],['goal-near',['launch-pilot']]])p=d.answerOnboardingQuestion(p,{questionId,values,useForDiscovery:true,now:10});for(const purpose of ['discovery','introduction'])for(const field of ['skillsOffered','needs','goals'])p=d.setFieldPermission(p,{purpose,field,allowed:true,now:10});return d.setDiscoveryEnabled(p,{enabled:true,now:10});}
  async function approve(){for(let i=0;i<2;i++){const c=client(i);await c.attach();await applied(c.updateProfile(profile(i)));await applied(c.enableDiscovery(['skillsOffered','needs','goals'],2000));}for(let i=0;i<2;i++){const c=client(i);await c.attach();await applied(c.pairAction('INTEREST'));}for(let i=0;i<2;i++){const c=client(i);await c.attach();await applied(c.pairAction('APPROVE',{fields:['skillsOffered']}));}}
  return {root,directory,operatorKey,owners,client,stop,resume,profile,approve,get app(){return app;}};
}

test('clean pinned restart replays native histories and preserves identity, discovery grant and bilateral disclosure',async t=>{
  const f=await fixture(t);await f.approve();const a=f.client(0);await a.attach();const before=await a.refresh(),view=await a.readPair(),url=f.app.url;
  assert.equal((await a.discover()).length,1);await f.stop();await f.resume();
  assert.equal(f.app.url,url);const b=f.client(0);await b.attach();assert.deepEqual(b.context(),before);assert.deepEqual(await b.readPair(),view);assert.equal((await b.discover()).length,1);
  assert.equal((await b.exportProfile()).displayLabel,'SECRET_K6_PROFILE_0');
  assert.deepEqual(f.app.health(),{mode:MODE,state:'RUNNING',durableCheckpoint:true,participants:2,productionAuthorized:false});
  const raw=await readFile(join(f.directory,'operator-checkpoint.json'),'utf8');assert(!raw.includes('SECRET_K6_PROFILE'));assert(!raw.includes('sensor-engineering'));assert(!raw.includes(f.operatorKey.toString('hex')));assert(!raw.includes('readerPrivate'));
});

test('restart preserves block and tombstone; old approval cannot resurrect deleted disclosure',async t=>{
  const f=await fixture(t);await f.approve();const a=f.client(0);await a.attach();await applied(a.pairAction('BLOCK'));await applied(a.deleteProfile(20));await f.stop();await f.resume();
  const b=f.client(1);await b.attach();assert.deepEqual(await b.discover(),[]);assert.deepEqual((await b.readPair()).disclosures,{});
  const restored=f.client(0);await restored.attach();await assert.rejects(restored.exportProfile(),/REJECTED/);
  assert((await readdir(join(f.directory,'01'))).includes('snapshot-0000.json'),'retained ciphertext is not physical erasure');
});

test('dirty source and lost-response client journal survive restart without reapplying or disclosing stale content',async t=>{
  const f=await fixture(t);await f.approve();let lost=true;
  const a=f.client(0,async(url,init)=>{const response=await fetch(url,{...init,headers:{...init.headers,Origin:f.app.url}});const v=JSON.parse(init.body);if(lost&&v.request?.operation==='VAULT'&&v.request.payload.kind==='COMMAND'){lost=false;await response.text();throw Error('LOST_RESPONSE');}return response;});await a.attach();
  const changed=d.setFieldPermission(await a.exportProfile(),{purpose:'introduction',field:'skillsOffered',allowed:false,now:20});assert.equal((await a.vaultCommand('PROFILE',changed)).status,'UNKNOWN');await f.stop();await f.resume();
  const b=f.client(1);await b.attach();await assert.rejects(b.readPair(),/SOURCE_SYNC_REQUIRED/);
  const recovering=f.client(0);await recovering.attach();assert.equal(recovering.pending(),true);assert.equal(recovering.context().needsSourceSync,true);await applied(recovering.reconcile());await applied(recovering.syncSource());assert.deepEqual((await b.readPair()).disclosures['synthetic:user-01'].skillsOffered,[]);
});

test('wrong external key/pin and changed origin fail closed; rejection does not poison a valid closed checkpoint',async t=>{
  const f=await fixture(t,1),pin=(await f.stop()).checkpointPin;
  for(const opts of [{operatorKey:randomBytes(32),resumePin:pin},{operatorKey:f.operatorKey,resumePin:'00'.repeat(32)},{operatorKey:f.operatorKey,resumePin:pin,port:Number(f.app.url.split(':').at(-1))===65535?65534:65535}]){
    await assert.rejects(startPrivateHub({directory:f.directory,mode:MODE,...opts}),/AUTHENTICATION|PIN_MISMATCH|SAME_ORIGIN/);
  }
  await f.resume(pin);const c=f.client(0);await c.attach();assert.equal(c.context().ownerKey,f.owners[0].ownerKey);
});

test('old challenges are not replayable after same-session restart; old checkpoint pin rejects newer state',async t=>{
  const f=await fixture(t,1),request={operation:'CONTEXT',payload:{}},post=(path,value)=>fetch(f.app.url+'/private-api/'+path,{method:'POST',headers:{Origin:f.app.url,'Content-Type':'application/json','X-BAARNE-Client':HUB_PRIVATE_VERSION},body:canonical(value)});
  const {challenge}=await (await post('challenge',{ownerKey:f.owners[0].ownerKey,requestHash:await hash(request)})).json();const envelope={challenge,signature:await f.owners[0].sign(hubMessage(challenge)),request};
  const old=(await f.stop()).checkpointPin;await f.resume();assert.equal((await post('request',envelope)).status,403);
  const a=f.client(0);await a.attach();await applied(a.updateProfile(f.profile(0)));const current=(await f.stop()).checkpointPin;assert.notEqual(old,current);
  await assert.rejects(f.resume(old),/PIN_MISMATCH/);await f.resume(current);const b=f.client(0);await b.attach();assert.equal((await b.exportProfile()).displayLabel,'SECRET_K6_PROFILE_0');
});

test('missing/tampered native history is rejected even when the operator checkpoint decrypts',async t=>{
  const f=await fixture(t,1);await f.stop();const target=join(f.directory,'01','snapshot-0000.json');await writeFile(target,'{}');await assert.rejects(f.resume());
  assert.equal(await readFile(target,'utf8'),'{}','failed replay must not repair or accept tampered history');
});

test('one operator owns even an empty workspace; real process kill leaves an explicit unclean-stop marker',async t=>{
  const f=await fixture(t,0);
  await assert.rejects(startPrivateHub({directory:f.directory,mode:MODE,operatorKey:f.operatorKey,resumePin:'00'.repeat(32)}),/OWNED|LOCK/);
  const pin=(await f.stop()).checkpointPin;
  const script=`import {startPrivateHub} from ${JSON.stringify(pathToFileURL(resolve('apps/hub/private-server.mjs')).href)}; let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s);await startPrivateHub({directory:v.directory,mode:'ISOLATED_SYNTHETIC_LAB',operatorKey:Buffer.from(v.key,'hex'),resumePin:v.pin});console.log('READY');`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe'],windowsHide:true}),exited=new Promise(ok=>child.once('close',ok));
  t.after(async()=>{if(child.exitCode===null)child.kill('SIGKILL');await exited;});
  const ready=new Promise((ok,no)=>{const lines=createInterface({input:child.stdout});let errors='';child.stderr.on('data',b=>{errors+=b;});const timer=setTimeout(()=>{child.kill('SIGKILL');no(Error('CHILD_START_TIMEOUT'));},15000);lines.once('line',line=>{clearTimeout(timer);lines.close();line==='READY'?ok():no(Error('CHILD_NOT_READY'));});child.once('exit',()=>{clearTimeout(timer);no(Error('CHILD_EXITED '+errors));});});
  child.stdin.end(JSON.stringify({directory:f.directory,key:f.operatorKey.toString('hex'),pin}));await ready;child.kill('SIGKILL');await exited;
  await assert.rejects(f.resume(pin),/UNCLEAN_OPERATOR_STOP/);
  assert((await readdir(f.directory)).includes('operator-active.json'));
});

test('bounded regular encrypted checkpoint rejects oversized input before decryption; invalid key creates no target',async t=>{
  const f=await fixture(t,0);await f.stop();const bytes=Buffer.alloc(1024*1024+1,32);await writeFile(join(f.directory,'operator-checkpoint.json'),bytes);await assert.rejects(f.resume(createHash('sha256').update(bytes).digest('hex')),/QUOTA/);
  const target=join(f.root,'invalid');await assert.rejects(startPrivateHub({directory:target,mode:MODE,operatorKey:Buffer.alloc(31)}),/KEY_REQUIRED/);await assert.rejects(lstat(target),{code:'ENOENT'});
});

test('failed checkpoint publication never returns a clean pin and leaves restart closed for review',async t=>{
  const f=await fixture(t,1),pin=(await f.stop()).checkpointPin;await f.resume(pin);
  await writeFile(join(f.directory,'operator-checkpoint.pending'),'synthetic blocked checkpoint publication',{flag:'wx'});
  await assert.rejects(f.app.close(),{code:'EEXIST'});
  assert.equal(f.app.health().state,'CLOSING_OR_CLOSED');
  await assert.rejects(f.resume(pin),/UNCLEAN_OPERATOR_STOP/);
});

test('closed encrypted backup restores into a new directory; native replay preserves consent and receipt state',async t=>{
  const f=await fixture(t);await f.approve();const a=f.client(0);await a.attach();const head=await a.refresh(),view=await a.readPair();
  await assert.rejects(backupClosedHub({directory:f.directory,target:join(f.root,'while-active'),checkpointPin:'00'.repeat(32)}),/OWNED|LOCK/);await assert.rejects(lstat(join(f.root,'while-active')),{code:'ENOENT'});
  const pin=(await f.stop()).checkpointPin,backup=join(f.root,'backup'),target=join(f.root,'replacement');
  const exported=await backupClosedHub({directory:f.directory,target:backup,checkpointPin:pin});assert.equal(exported.state,'ENCRYPTED_BYTE_BACKUP_NOT_OWNER_EXPORT');
  const copied=await restoreClosedHub({backupDirectory:backup,target,backupPin:exported.backupPin,checkpointPin:pin});assert.equal(copied.state,'COPIED_NOT_REPLAY_VERIFIED');assert.equal(copied.checkpointPin,pin);
  const app=await startPrivateHub({directory:target,mode:MODE,operatorKey:f.operatorKey,resumePin:pin,clock:()=>1000});
  try{const c=f.client(0);await c.attach();assert.deepEqual(await c.refresh(),head);assert.deepEqual(await c.readPair(),view);assert.equal((await c.discover()).length,1);}finally{await app.close();}
  const names=await readdir(backup);assert(!names.includes('operator.lock'));assert(!names.includes('operator-active.json'));
  for(const name of names.filter(n=>n.endsWith('.json'))){const raw=await readFile(join(backup,name),'utf8');assert(!raw.includes('SECRET_K6_PROFILE'));assert(!raw.includes(f.operatorKey.toString('hex')));}
});

test('backup transfer rejects wrong pin, missing/changed/extra files and existing targets before creating a destination',async t=>{
  const f=await fixture(t,1),pin=(await f.stop()).checkpointPin,backup=join(f.root,'backup'),target=join(f.root,'not-created');
  await assert.rejects(backupClosedHub({directory:f.directory,target:backup,checkpointPin:'00'.repeat(32)}),/PIN_MISMATCH/);await assert.rejects(lstat(backup),{code:'ENOENT'});
  const exported=await backupClosedHub({directory:f.directory,target:backup,checkpointPin:pin}),opts={backupDirectory:backup,target,backupPin:exported.backupPin,checkpointPin:pin};
  await assert.rejects(restoreClosedHub({...opts,backupPin:'00'.repeat(32)}),/PIN_MISMATCH/);
  const path=join(backup,'01','snapshot-0000.json'),raw=await readFile(path);await writeFile(path,'{}');await assert.rejects(restoreClosedHub(opts),/CHECKSUM/);await assert.rejects(lstat(target),{code:'ENOENT'});
  await unlink(path);await assert.rejects(restoreClosedHub(opts),/LENGTH/);await assert.rejects(lstat(target),{code:'ENOENT'});await writeFile(path,raw);
  const extra=join(backup,'unexpected.json');await writeFile(extra,'{}');await assert.rejects(restoreClosedHub(opts),/UNEXPECTED/);await unlink(extra);await assert.rejects(lstat(target),{code:'ENOENT'});
  await restoreClosedHub(opts);await assert.rejects(restoreClosedHub(opts),/TARGET_EXISTS/);
  await assert.rejects(backupClosedHub({directory:f.directory,target:join(f.directory,'nested'),checkpointPin:pin}),/INSIDE_SOURCE/);
});

test('authenticated but invalid operator state cannot be interpreted as a new empty workspace',async t=>{
  const f=await fixture(t,0),pin=(await f.stop()).checkpointPin;
  const writer=await operatorCheckpoint({directory:f.directory,key:f.operatorKey,resumePin:pin});let badPin;
  try{await writer.activate();badPin=(await writer.finish(null)).checkpointPin;}finally{await writer.close();}
  await assert.rejects(f.resume(badPin),/INVALID_OPERATOR_STATE/);
});

test('a valid older backup cannot satisfy the expected checkpoint after consent withdrawal',async t=>{
  const f=await fixture(t);await f.approve();const old=(await f.stop()).checkpointPin,backup=join(f.root,'prior-consent');
  const exported=await backupClosedHub({directory:f.directory,target:backup,checkpointPin:old});await f.resume(old);
  const c=f.client(0);await c.attach();await applied(c.pairAction('WITHDRAW'));const latest=(await f.stop()).checkpointPin;
  const target=join(f.root,'must-not-restore-old-consent');
  await assert.rejects(restoreClosedHub({backupDirectory:backup,target,backupPin:exported.backupPin}),/EXPECTED_CHECKPOINT_PIN_REQUIRED/);
  await assert.rejects(restoreClosedHub({backupDirectory:backup,target,backupPin:exported.backupPin,checkpointPin:latest}),/STALE_HUB_CHECKPOINT/);await assert.rejects(lstat(target),{code:'ENOENT'});
});
