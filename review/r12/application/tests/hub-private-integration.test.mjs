import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {startPrivateHub} from '../apps/hub/private-server.mjs';
import {PrivateHubClient} from '../apps/hub/public/private-client.mjs';
import {createBrowserOwner,restoreBrowserOwner,VAULT,PAIR,HANDOFF,NOTICE,HUB_PRIVATE_VERSION,canonical,hash,hubMessage,ownerMessage,pairMessage,handoffMessage,noticeMessage,nonce} from '../apps/hub/public/private-protocol.mjs';
import {projectIntroductionProfile} from '../packages/behavioral-twin/src/handoff-projection.mjs';
import * as d from '../packages/behavioral-twin/src/index.mjs';
const PASSWORD='synthetic-only password, never a user secret';
const pass=async result=>{const r=await result;assert.equal(r.status,'APPLIED',r.reason??JSON.stringify(r));return r;};
function storage(){const rows=new Map();return {rows,get:async k=>rows.get(k)??null,put:async(k,v)=>rows.set(k,v),remove:async k=>rows.delete(k)};}
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'baarne-k5-')),directory=join(root,'workspace');let now=1000;
  const app=await startPrivateHub({directory,mode:'ISOLATED_SYNTHETIC_LAB',clock:()=>now}),owners=[],clients=[],storages=[];
  t.after(async()=>{for(const owner of owners)owner.lock();await app.close();await rm(root,{recursive:true,force:true});});
  const transport=async(url,init)=>fetch(url,{...init,headers:{...init.headers,Origin:app.url}});
  const clientFor=(owner,local=storage(),fetch=transport)=>new PrivateHubClient({owner,url:app.url,fetch,storage:local,projectIntroductionProfile,fields:d.DISCOVERY_FIELDS});
  for(let i=0;i<2;i++){const owner=await createBrowserOwner(PASSWORD),local=storage(),client=clientFor(owner,local);owners.push(owner);clients.push(client);storages.push(local);await client.attach({enroll:true});}
  function profile(i,at=10){let p=d.createTwinProfile({userId:clients[i].context().actorId,displayLabel:'PRIVATE_OWNER_MARKER_'+i,now:0});for(const [questionId,values] of [['skill-technical',[i?'solar-installation':'sensor-engineering']],['need-build',[i?'sensor-monitoring':'solar-expertise']],['goal-near',['launch-pilot']]])p=d.answerOnboardingQuestion(p,{questionId,values,useForDiscovery:true,now:at});p=d.answerOnboardingQuestion(p,{questionId:'interest-activities',values:['remote-travel'],useForDiscovery:false,now:at});for(const field of ['skillsOffered','needs','goals'])for(const purpose of ['discovery','introduction'])p=d.setFieldPermission(p,{purpose,field,allowed:true,now:at});return d.setDiscoveryEnabled(p,{enabled:true,now:at});}
  async function profiles(){for(let i=0;i<2;i++){await pass(clients[i].updateProfile(profile(i)));await pass(clients[i].enableDiscovery(['skillsOffered','needs','goals'],2000));}}
  async function approved(){await profiles();for(const c of clients)await pass(c.pairAction('INTEREST'));await pass(clients[0].pairAction('APPROVE',{fields:['skillsOffered']}));assert.deepEqual((await clients[1].readPair()).disclosures,{});await pass(clients[1].pairAction('APPROVE',{fields:['skillsOffered']}));}
  return {app,root,directory,owners,clients,storages,clientFor,profile,profiles,approved,transport,setNow:value=>now=value};
}

test('A5 two isolated WebCrypto owners traverse encrypted vault, consented explanations and bilateral introduction/connection',async t=>{
  const f=await fixture(t);await f.profiles();assert.notEqual(f.owners[0].ownerKey,f.owners[1].ownerKey);
  for(const c of f.clients){const matches=await c.discover();assert.equal(matches.length,1);assert(matches[0].explanations.length>=2);assert(!JSON.stringify(matches).includes('remote-travel'));assert(!JSON.stringify(matches).includes('PRIVATE_OWNER_MARKER'));assert(!JSON.stringify(matches).includes('internalScore'));}
  for(const c of f.clients)await pass(c.pairAction('INTEREST'));
  await pass(f.clients[0].pairAction('APPROVE',{fields:['skillsOffered']}));assert.deepEqual((await f.clients[1].readPair()).disclosures,{});
  await pass(f.clients[1].pairAction('APPROVE',{fields:['skillsOffered']}));const view=await f.clients[1].readPair();assert.equal(view.state,'INTRODUCTION_APPROVED');assert.deepEqual(view.disclosures['synthetic:user-01'],{skillsOffered:['sensor-engineering']});
  for(const c of f.clients)await pass(c.pairAction('CONNECT'));assert.equal((await f.clients[0].readPair()).state,'CONNECTED');
  assert.equal(d.assertNoCoreReferenceCreation(view),true);
  async function checkEncrypted(dir){for(const name of await readdir(dir,{withFileTypes:true})){const path=join(dir,name.name);if(name.isDirectory())await checkEncrypted(path);else if(name.name!=='writer.lock'){const raw=await readFile(path,'utf8');assert(!raw.includes('PRIVATE_OWNER_MARKER'));assert(!raw.includes('sensor-engineering'));assert(!raw.includes('remote-travel'));}}}await checkEncrypted(f.directory);
});

test('A5 ownership cannot be selected or forged; wrong actor/scope and wrong-origin HTTP are rejected',async t=>{
  const f=await fixture(t);await f.profiles();const [a,b]=f.clients;
  await assert.rejects(b.request('VAULT',{kind:'OWNER_VIEW',record:{body:{},signature:'00'.repeat(64)}}),/REJECTED/);
  const c=await a.refresh(),body={version:PAIR,scope:c.pairHead.scope,actorId:c.actorId,revision:c.pairHead.revision+1,actionId:'forged:'+nonce(),operation:'INTEREST',payload:{}};
  const record={body,signature:await f.owners[1].sign(pairMessage(body))};await assert.rejects(b.request('PAIR',{kind:'COMMAND',record}),/REJECTED/);
  const va={version:VAULT,scope:c.vaultHead.scope,revision:c.vaultHead.revision+1,action:'DELETE',payload:{}};
  await assert.rejects(b.request('VAULT',{kind:'COMMAND',record:{body:va,signature:await f.owners[0].sign(ownerMessage(va))}}),/REJECTED/);
  const wrong=await fetch(f.app.url+'/private-api/challenge',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json','X-BAARNE-Client':'BAARNE_LOCAL_SYNTHETIC_HUB_V1'},body:'{}'});assert.equal(wrong.status,403);
  const native=await fetch(f.app.url+'/private-api/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(native.status,403);
  assert.equal((await a.exportProfile()).userId,'synthetic:user-01');assert.equal((await b.exportProfile()).userId,'synthetic:user-02');
});

test('A6 changed source with missing handoff fails closed; withdrawal and re-enabled permissions never resurrect old disclosure',async t=>{
  const f=await fixture(t);await f.approved();const a=f.clients[0],b=f.clients[1];
  const revoked=d.setFieldPermission(await a.exportProfile(),{purpose:'introduction',field:'skillsOffered',allowed:false,now:20});
  await pass(a.vaultCommand('PROFILE',revoked));await assert.rejects(b.readPair(),/SOURCE_SYNC_REQUIRED/);await assert.rejects(b.discover(),/SOURCE_SYNC_REQUIRED/);
  await pass(a.syncSource());assert.deepEqual((await b.readPair()).disclosures['synthetic:user-01'].skillsOffered,[]);
  await pass(a.updateProfile(d.setFieldPermission(revoked,{purpose:'introduction',field:'skillsOffered',allowed:true,now:21})));
  assert.deepEqual((await b.readPair()).disclosures['synthetic:user-01'].skillsOffered,[]);
  await pass(a.revokeDiscovery());assert.deepEqual(await b.discover(),[]);assert.deepEqual(await a.discover(),[]);
  await pass(a.pairAction('WITHDRAW'));assert.deepEqual((await b.readPair()).disclosures,{});
  const refused=await b.pairAction('CONNECT');assert.equal(refused.status,'UNKNOWN');assert.equal((await b.reconcile()).status,'NOT_APPLIED');await b.discardNotApplied();
});

test('A6 signed block is enforced for both clients; discovery grant expiry and deletion do not create erasure claims',async t=>{
  const f=await fixture(t);await f.approved();f.setNow(2001);assert.deepEqual(await f.clients[0].discover(),[]);f.setNow(1000);
  await pass(f.clients[0].pairAction('BLOCK'));assert.equal((await f.clients[1].readPair()).state,'BLOCKED');assert.deepEqual(await f.clients[1].discover(),[]);
  const before=await f.clients[0].exportProfile();assert.equal(before.userId,'synthetic:user-01');
  await pass(f.clients[0].deleteProfile(30));await assert.rejects(f.clients[0].exportProfile(),/REJECTED/);assert.deepEqual((await f.clients[1].readPair()).disclosures,{});
  const names=await readdir(join(f.directory,'01'));assert(names.some(n=>n==='snapshot-0000.json'),'historical ciphertext is retained, not physical erasure');
});

test('A6 encrypted owner recovery restores same identity and durable pending receipt after response loss, never admin resets',async t=>{
  const f=await fixture(t);await f.profiles();const a=f.clients[0],backup=a.backup();
  await assert.rejects(restoreBrowserOwner(backup,'wrong synthetic passphrase'),/operation|decrypt|data/i);
  const changed=structuredClone(backup);changed.header.ownerKey=f.owners[1].ownerKey;await assert.rejects(restoreBrowserOwner(changed,PASSWORD));
  let drop=true;
  const losing=async(url,init)=>{const response=await f.transport(url,init);const value=JSON.parse(init.body);if(drop&&value.request?.operation==='VAULT'&&value.request.payload.kind==='COMMAND'){drop=false;await response.text();throw Error('SYNTHETIC_RESPONSE_LOST');}return response;};
  const recovering=f.clientFor(f.owners[0],f.storages[0],losing);await recovering.attach();
  const profile=d.setFieldPermission(await recovering.exportProfile(),{purpose:'introduction',field:'goals',allowed:false,now:20});
  assert.equal((await recovering.vaultCommand('PROFILE',profile)).status,'UNKNOWN');assert.equal(recovering.pending(),true);
  const journal=[...f.storages[0].rows.values()].join('');assert(!journal.includes('PRIVATE_OWNER_MARKER'));assert(!journal.includes('sensor-engineering'));
  recovering.lock();const owner=await restoreBrowserOwner(backup,PASSWORD);f.owners.push(owner);const restored=f.clientFor(owner,f.storages[0]);await restored.attach();assert.equal(restored.pending(),true);await pass(restored.reconcile());assert.equal(restored.ownerKey,a.ownerKey);assert.equal(restored.pending(),false);await pass(restored.syncSource());
  const badStorage={get:async()=>'{"iv":"00","data":"00"}',put:async()=>{},remove:async()=>{}};await assert.rejects(f.clientFor(owner,badStorage).attach());
  const other=await createBrowserOwner(PASSWORD);f.owners.push(other);await assert.rejects(f.clientFor(other).attach(),/REJECTED/);
});

test('minimal source notices cannot claim deletion of a live vault; current source pin is mandatory',async t=>{
  const f=await fixture(t);await f.profiles();const a=f.clients[0],c=await a.refresh();
  const body={version:NOTICE,sourceHead:c.vaultHead,destination:c.pairHead.scope,actorId:c.actorId,action:'DELETE',sourceDeleted:true,now:30,nonce:nonce()};
  const notice={body,signature:await f.owners[0].sign(noticeMessage(body))};const r=await a.pairAction('SOURCE_NOTICE',{notice});assert.equal(r.status,'UNKNOWN');await a.discardNotApplied();assert((await a.exportProfile()).status==='ACTIVE');
  const stale={...body,action:'REVOKE',sourceDeleted:false,sourceHead:{...c.vaultHead,head:'00'.repeat(32)}};
  const result=await a.pairAction('SOURCE_NOTICE',{notice:{body:stale,signature:await f.owners[0].sign(noticeMessage(stale))}});assert.equal(result.status,'UNKNOWN');await a.discardNotApplied();
});

test('Hub rejects legacy direct pair profile/deletion and fabricated handoff despite valid owner signatures',async t=>{
  const f=await fixture(t);await f.profiles();const a=f.clients[0],c=await a.refresh();
  for(const [operation,payload] of [['PROFILE',{profile:f.profile(0,20)}],['DELETE',{now:30}]]){assert.equal((await a.pairAction(operation,payload)).status,'UNKNOWN');await a.discardNotApplied();}
  const fake=projectIntroductionProfile(f.profile(0,20),['skillsOffered']);
  const body={version:HANDOFF,sourceHead:c.vaultHead,destination:c.pairHead.scope,actorId:c.actorId,fields:['skillsOffered'],profile:fake,nonce:nonce()};
  const r=await a.pairAction('HANDOFF',{handoff:{body,signature:await f.owners[0].sign(handoffMessage(body))}});assert.equal(r.status,'UNKNOWN');await a.discardNotApplied();
  assert.equal((await a.readPair()).state,'DISCOVERED');
});

test('request challenges are scope-bound, expire and are consumed once; storage failure prevents sending a mutation',async t=>{
  const f=await fixture(t),request={operation:'CONTEXT',payload:{}};
  const post=(path,value)=>f.transport(f.app.url+'/private-api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-BAARNE-Client':HUB_PRIVATE_VERSION},body:canonical(value)});
  const {challenge}=await (await post('challenge',{ownerKey:f.owners[0].ownerKey,requestHash:await hash(request)})).json();
  const envelope={challenge,signature:await f.owners[0].sign(hubMessage(challenge)),request};
  assert.equal((await post('request',envelope)).status,200);assert.equal((await post('request',envelope)).status,403);
  const expired=await (await post('challenge',{ownerKey:f.owners[0].ownerKey,requestHash:await hash(request)})).json();f.setNow(1016);
  assert.equal((await post('request',{challenge:expired.challenge,signature:await f.owners[0].sign(hubMessage(expired.challenge)),request})).status,403);
  const failStorage={get:async()=>null,put:async()=>{throw Error('STORAGE_UNAVAILABLE');},remove:async()=>{}};
  const client=f.clientFor(f.owners[0],failStorage);await client.attach();const before=client.context().vaultHead;
  await assert.rejects(client.vaultCommand('PROFILE',f.profile(0)),/STORAGE_UNAVAILABLE/);assert.deepEqual((await client.refresh()).vaultHead,before);
});

test('private Hub entry is explicit, bounded and loopback only; existing demo remains read-only',async t=>{
  const f=await fixture(t);const page=await fetch(f.app.url+'/private.html');assert.equal(page.status,200);assert(page.headers.get('content-security-policy').includes("connect-src 'self'"));const html=await page.text();assert(html.includes('NO-GO'));assert(!html.includes('demo-actor'));
  for(const path of ['/private-client.mjs','/private-protocol.mjs','/private-app.mjs','/domain/handoff-projection.mjs'])assert.equal((await fetch(f.app.url+path)).status,200);
  assert.equal((await fetch(f.app.url+'/health')).status,200);assert.equal((await fetch(f.app.url+'/any',{method:'POST'})).status,405);
  await assert.rejects(startPrivateHub({directory:join(f.root,'bad'),mode:'PRODUCTION'}),/EXPLICIT/);await assert.rejects(startPrivateHub({directory:join(f.root,'bad'),mode:'ISOLATED_SYNTHETIC_LAB',host:'0.0.0.0'}),/EXPLICIT/);
});

test('browser default fetch keeps its Window receiver and concurrent read requests serialize without incidental busy errors',async t=>{
  const f=await fixture(t),original=globalThis.fetch;let calls=0,client;
  globalThis.fetch=function(url,init){assert.equal(this,globalThis);calls++;return original(url,{...init,headers:{...init.headers,Origin:f.app.url}});};
  try{client=new PrivateHubClient({owner:f.owners[0],url:f.app.url,storage:storage(),projectIntroductionProfile,fields:d.DISCOVERY_FIELDS});}finally{globalThis.fetch=original;}
  await client.attach();assert(calls>=2);
  const results=await Promise.all(Array.from({length:6},(_,i)=>f.clients[i%2].request('CONTEXT')));
  assert.equal(results.length,6);assert(results.every(r=>r.productionAuthorized===false));
});

test('idempotent old profile command cannot roll back the gateway consent cache or re-authorize a stale disclosure',async t=>{
  const f=await fixture(t);await f.profiles();const a=f.clients[0],original=await a.exportProfile(),oldContext=await a.refresh();
  const body={version:VAULT,scope:oldContext.vaultHead.scope,revision:oldContext.vaultHead.revision+1,action:'PROFILE',payload:{...original,updatedAt:20}};
  const record={body,signature:await f.owners[0].sign(ownerMessage(body))};await a.request('VAULT',{kind:'COMMAND',record});await pass(a.syncSource());
  const revoked=d.setFieldPermission(body.payload,{purpose:'introduction',field:'skillsOffered',allowed:false,now:21});await pass(a.updateProfile(revoked));
  const current=await a.refresh();await a.request('VAULT',{kind:'COMMAND',record});assert.deepEqual((await a.refresh()).vaultHead,current.vaultHead);
  const handoffBody={version:HANDOFF,sourceHead:current.vaultHead,destination:current.pairHead.scope,actorId:current.actorId,fields:['skillsOffered'],profile:projectIntroductionProfile(body.payload,['skillsOffered']),nonce:nonce()};
  assert.equal((await a.pairAction('HANDOFF',{handoff:{body:handoffBody,signature:await f.owners[0].sign(handoffMessage(handoffBody))}})).status,'UNKNOWN');await a.discardNotApplied();
  assert.equal((await a.exportProfile()).fieldPermissions.introduction.skillsOffered,false);
});
