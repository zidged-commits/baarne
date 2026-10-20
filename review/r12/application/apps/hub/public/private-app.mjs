import * as domain from '/domain/index.mjs';
import {projectIntroductionProfile} from '/domain/handoff-projection.mjs';
import {createBrowserOwner,restoreBrowserOwner} from './private-protocol.mjs';
import {PrivateHubClient} from './private-client.mjs';
const $=id=>document.getElementById(id);
let client,owner,profile;
const storage={get:async key=>localStorage.getItem(key),put:async(key,value)=>localStorage.setItem(key,value),remove:async key=>localStorage.removeItem(key)};
const stamp=()=>Math.max(Date.now(),(profile?.updatedAt??0)+1);
const download=(name,value)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function status(value){if(typeof value==='string'){$('status').textContent=value;return;}const messages={APPLIED:'İmzalı işlem uygulandı.',OWNER_ATTACHED:'Sahip imzası doğrulandı.',NOT_APPLIED:'İşlem uygulanmadı; güvenle bırakabilir veya tekrar gönderebilirsiniz.',IN_PROGRESS:'İşlem sürüyor; sonucunu tekrar sorgulayın.',UNKNOWN:'Sonuç belirsiz. Önce bekleyen işlemin sonucunu sorgulayın.',PEER_NOT_ENROLLED:'İkinci sentetik sahip henüz katılmadı.'};$('status').textContent=(messages[value.status]??value.status??'Sonuç alındı.')+(value.actorId?' '+value.actorId:'');}
async function showProfile(){profile=await client.exportProfile();renderQuestion();}
function renderQuestion(){if(!profile)return;const q=domain.ONBOARDING_QUESTIONS.find(q=>q.id===$('question').value),answer=profile.answers[q.id];$('options').replaceChildren(...q.options.map(value=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=value;input.checked=answer?.values.includes(value)??false;label.append(input,document.createTextNode(value));return label;}));$('answer-discovery').checked=answer?.useForDiscovery??false;$('field-discovery').checked=profile.fieldPermissions.discovery[q.field];$('field-introduction').checked=profile.fieldPermissions.introduction[q.field];}
for(const q of domain.ONBOARDING_QUESTIONS){const option=document.createElement('option');option.value=q.id;option.textContent=q.prompt;$('question').append(option);}
$('question').addEventListener('change',renderQuestion);
async function connect(next,enroll){
  client?.lock();$('pair').textContent='';$('matches').textContent='';owner=next;client=new PrivateHubClient({owner,url:location.origin,storage,projectIntroductionProfile,fields:domain.DISCOVERY_FIELDS});
  const c=await client.attach({enroll});$('workspace').hidden=false;$('actor').textContent=c.actorId+' · sahip izi '+c.ownerKey.slice(0,12);
  $('backup').disabled=false;$('lock').disabled=false;await showProfile();return {status:'OWNER_ATTACHED',actorId:c.actorId,pending:client.pending()};
}
const action=(id,fn)=>$(id).addEventListener('click',async()=>{const buttons=[...document.querySelectorAll('button')],prior=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);if(!['read','discover','backup','export'].includes(id)){$('pair').textContent='';$('matches').textContent='';}try{status(await fn());}catch(error){status('Başarı doğrulanmadı: '+error.message);}finally{buttons.forEach((b,i)=>b.disabled=prior[i]);$('backup').disabled=!client;$('lock').disabled=!client;}});
action('create',async()=>{const password=$('password').value;$('password').value='';const result=await connect(await createBrowserOwner(password),true);download('baarne-synthetic-owner.encrypted.json',owner.backup());return result;});
action('restore',async()=>{const file=$('backup-file').files[0];if(!file||file.size>8192)throw Error('BOUNDED_ENCRYPTED_OWNER_FILE_REQUIRED');const password=$('password').value;$('password').value='';return connect(await restoreBrowserOwner(JSON.parse(await file.text()),password),false);});
action('backup',()=>{download('baarne-synthetic-owner.encrypted.json',client.backup());return 'Şifreli sahip dosyası indirildi; parolayı ayrı saklayın.';});
action('lock',()=>{client?.lock();client=null;owner=null;profile=null;$('workspace').hidden=true;$('actor').textContent='';$('matches').textContent='';$('pair').textContent='';$('options').replaceChildren();return 'Sahip kilitlendi.';});
action('save',async()=>{profile=await client.exportProfile();const q=domain.ONBOARDING_QUESTIONS.find(q=>q.id===$('question').value),values=[...$('options').querySelectorAll('input:checked')].map(x=>x.value),now=stamp();let next=values.length?domain.answerOnboardingQuestion(profile,{questionId:q.id,values,useForDiscovery:$('answer-discovery').checked,now}):domain.skipOnboardingQuestion(profile,{questionId:q.id,now});for(const purpose of ['discovery','introduction'])next=domain.setFieldPermission(next,{purpose,field:q.field,allowed:$('field-'+purpose).checked,now});const result=await client.updateProfile(next);if(result.status==='APPLIED')await showProfile();return result;});
action('grant',async()=>{profile=await client.exportProfile();const result=await client.updateProfile(domain.setDiscoveryEnabled(profile,{enabled:true,now:stamp()}));if(result.status!=='APPLIED')return result;return client.enableDiscovery();});
action('revoke',()=>client.revokeDiscovery());
action('discover',async()=>{const result=await client.discover();$('matches').textContent=JSON.stringify(result,null,2);return 'Yalnız güncel izinli alanlarla eşleştirme yapıldı.';});
action('sync',()=>client.syncSource());
action('approve',async()=>{profile=await client.exportProfile();return client.pairAction('APPROVE',{fields:domain.DISCOVERY_FIELDS.filter(f=>profile.fieldPermissions.introduction[f])});});
for(const button of document.querySelectorAll('[data-pair]')){button.id='pair-'+button.dataset.pair;action(button.id,()=>client.pairAction(button.dataset.pair));}
action('read',async()=>{const result=await client.readPair();$('pair').textContent=JSON.stringify(result,null,2);return result.state;});
action('export',async()=>{download('baarne-synthetic-profile.json',await client.exportProfile());return 'Yalnız kendi profiliniz dışa aktarıldı.';});
action('delete',async()=>{const now=stamp();profile=null;$('options').replaceChildren();for(const id of ['answer-discovery','field-discovery','field-introduction'])$(id).checked=false;const result=await client.deleteProfile(now);if(result.status==='APPLIED')$('workspace').hidden=true;return result;});
action('reconcile',()=>client.reconcile());action('retry',()=>client.retryPending());action('discard',()=>client.discardNotApplied());
