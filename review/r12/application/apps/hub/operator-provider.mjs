// Synthetic CurrentUser DPAPI provider. Never provisions a production identity.
// Caller pins descriptor AND control separately; neither proves global freshness.
import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {lstat,mkdir,open,readdir,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {canonical} from '../../experiments/cometbft-fee-free-lab/application.mjs';
import {exact} from '../../experiments/cometbft-fee-free-lab/lifecycle-v3.mjs';
import {protectLabSecret,unprotectLabSecret} from '../../experiments/cometbft-fee-free-lab/windows-lab-key.mjs';
import {readBoundedRegularFile} from '../../experiments/cometbft-fee-free-lab/bounded-input.mjs';
import {acquireVaultLock} from '../../experiments/cometbft-fee-free-lab/windows-vault-lock.mjs';
import {startPrivateHub} from './private-server.mjs';
import {backupClosedHub,restoreClosedHub} from './operator-backup.mjs';
const MODE='ISOLATED_SYNTHETIC_LAB',VERSION='BAARNE_SYNTHETIC_HUB_DPAPI_PROVIDER_V1',CONTROL='BAARNE_SYNTHETIC_HUB_OPERATOR_CONTROL_V2';
const sha=b=>createHash('sha256').update(b).digest('hex'),pin=p=>typeof p==='string'&&/^[0-9a-f]{64}$/.test(p);
const mac=(key,body)=>createHmac('sha256',key).update(CONTROL+'\n'+canonical(body)).digest('hex');
function lab(mode){if(mode!==MODE)throw Error('EXPLICIT_SYNTHETIC_OPERATOR_MODE_REQUIRED');if(process.platform!=='win32')throw Error('WINDOWS_SYNTHETIC_PROVIDER_REQUIRED');}
function distinct(a,b){
  if(typeof a!=='string'||!a||typeof b!=='string'||!b)throw Error('EXPLICIT_OPERATOR_PATHS_REQUIRED');
  const x=resolve(a).toLowerCase(),y=resolve(b).toLowerCase();
  if(x===y||x.startsWith(y+'\\')||y.startsWith(x+'\\'))throw Error('PROVIDER_AND_WORKSPACE_MUST_BE_SEPARATE');
}
async function dir(path){const st=await lstat(path);if(!st.isDirectory()||st.isSymbolicLink())throw Error('INVALID_OPERATOR_PROVIDER_DIRECTORY');}
async function absent(path){try{await lstat(path);}catch(e){if(e.code==='ENOENT')return;throw e;}throw Error('OPERATOR_TARGET_EXISTS');}
async function write(path,raw){const f=await open(path,'wx',0o600);try{await f.writeFile(raw);await f.sync();}finally{await f.close();}}
function view(providerPin,raw,body){return {mode:MODE,providerPin,controlPin:sha(raw),state:body.state,sequence:body.sequence,workspace:body.workspace,checkpointPin:body.checkpointPin,pendingPin:body.pendingPin,productionAuthorized:false};}
function encodedControl(key,body){return canonical({body,authentication:mac(key,body)});}

export async function provisionHubOperator({mode,providerDirectory,workspace,port=0,storagePolicy}={}){
  lab(mode);distinct(providerDirectory,workspace);
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('INVALID_OPERATOR_PORT');
  const provider=resolve(providerDirectory),target=resolve(workspace);await absent(provider);await absent(target);
  const key=randomBytes(32),providerId=randomBytes(32).toString('hex');let app;
  try{
    const scope={mode:MODE,network:'baarne:hub-private-lab',account:providerId,role:'VAULT_ENCRYPTION'};
    const descriptor={version:VERSION,mode:MODE,providerId,scope,protected:protectLabSecret(key,scope)},raw=canonical(descriptor);
    await mkdir(provider,{mode:0o700});await write(join(provider,'provider.json'),raw);
    app=await startPrivateHub({directory:target,mode:MODE,operatorKey:key,port,storagePolicy});const closed=await app.close();
    const body={version:CONTROL,mode:MODE,providerId,workspace:target,sequence:0,state:'CLEAN',checkpointPin:closed.checkpointPin,pendingPin:null};
    const control=encodedControl(key,body);await write(join(provider,'control.json'),control);
    return view(sha(raw),control,body);
  }finally{try{await app?.close();}finally{key.fill(0);}}
}

async function load({mode,providerDirectory,providerPin,controlPin}={}){
  lab(mode);if(typeof providerDirectory!=='string'||!providerDirectory||!pin(providerPin)||!pin(controlPin))throw Error('EXTERNAL_PROVIDER_AND_CONTROL_PINS_REQUIRED');
  const directory=resolve(providerDirectory);await dir(directory);const lock=await acquireVaultLock(join(directory,'provider.lock'));let key;
  try{
    const names=await readdir(directory);if(names.some(n=>!['provider.json','control.json','provider.lock'].includes(n)))throw Error('OPERATOR_PROVIDER_UNEXPECTED_OR_PENDING_ENTRY');
    const raw=await readBoundedRegularFile(join(directory,'provider.json'),24576,'INVALID_OPERATOR_PROVIDER','OPERATOR_PROVIDER_QUOTA');
    if(sha(raw)!==providerPin)throw Error('OPERATOR_PROVIDER_PIN_MISMATCH');
    const d=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));exact(d,['version','mode','providerId','scope','protected']);
    const scope={mode:MODE,network:'baarne:hub-private-lab',account:d.providerId,role:'VAULT_ENCRYPTION'};
    if(canonical(d)!==raw.toString('utf8')||d.version!==VERSION||d.mode!==MODE||!pin(d.providerId)||canonical(d.scope)!==canonical(scope))throw Error('INVALID_OPERATOR_PROVIDER');
    const control=await readBoundedRegularFile(join(directory,'control.json'),16384,'INVALID_OPERATOR_CONTROL','OPERATOR_CONTROL_QUOTA');
    if(sha(control)!==controlPin)throw Error('OPERATOR_CONTROL_PIN_MISMATCH');
    const row=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(control));exact(row,['body','authentication']);exact(row.body,['version','mode','providerId','workspace','sequence','state','checkpointPin','pendingPin']);
    const b=row.body;
    if(canonical(row)!==control.toString('utf8')||b.version!==CONTROL||b.mode!==MODE||b.providerId!==d.providerId||!Number.isSafeInteger(b.sequence)||b.sequence<0||b.sequence>1000000||!['CLEAN','RUNNING','COPYING_RESTORE','RESTORED_UNVERIFIED'].includes(b.state)||!pin(b.checkpointPin)||b.pendingPin!==null&&!pin(b.pendingPin)||b.state!=='RUNNING'&&b.pendingPin!==null||!pin(row.authentication)||typeof b.workspace!=='string'||resolve(b.workspace)!==b.workspace)throw Error('INVALID_OPERATOR_CONTROL');
    distinct(directory,b.workspace);key=unprotectLabSecret(d.protected,scope);
    if(!timingSafeEqual(Buffer.from(row.authentication,'hex'),Buffer.from(mac(key,b),'hex')))throw Error('OPERATOR_CONTROL_AUTHENTICATION_FAILED');
    lock.assertOwned();let body=b,bytes=control;
    return {
      key,publicState:()=>view(providerPin,bytes,body),
      assertClean(transitions=0){if(!['CLEAN','RESTORED_UNVERIFIED'].includes(body.state))throw Error('OPERATOR_UNCLEAN_STATE_REQUIRES_REVIEW');if(body.sequence+transitions>1000000)throw Error('OPERATOR_CONTROL_QUOTA');},
      assertCapacity(transitions){if(body.sequence+transitions>1000000)throw Error('OPERATOR_CONTROL_QUOTA');},
      async save(state,workspace=body.workspace,checkpointPin=body.checkpointPin,pendingPin=null){
        lock.assertOwned();if(body.sequence>=1000000)throw Error('OPERATOR_CONTROL_QUOTA');
        const next={...body,sequence:body.sequence+1,state,workspace,checkpointPin,pendingPin},raw=encodedControl(key,next);
        await write(join(directory,'control.pending'),raw);lock.assertOwned();await rename(join(directory,'control.pending'),join(directory,'control.json'));body=next;bytes=raw;return view(providerPin,bytes,body);
      },
      async close(){key.fill(0);await lock.close();}
    };
  }catch(e){key?.fill(0);await lock.close();throw e;}
}

export async function inspectHubOperator(options){const p=await load(options);try{return p.publicState();}finally{await p.close();}}

export async function runHubOperator(options){
  const p=await load(options);let app;
  try{
    const old=p.publicState(),recover=options.recover===true;
    if(recover){if(old.state!=='RUNNING')throw Error('RUNNING_STATE_REQUIRED_FOR_EXPLICIT_RECOVERY');p.assertCapacity(2);}else{p.assertClean(2);await p.save('RUNNING');}
    app=await startPrivateHub({directory:old.workspace,mode:MODE,operatorKey:p.key,resumePin:old.checkpointPin,recover,pendingPin:recover?old.pendingPin:null,faultHook:options.faultHook,
      onDurableState:async next=>{p.assertCapacity(next.phase==='PREPARED'?3:2);const state=await p.save('RUNNING',old.workspace,next.checkpointPin,next.pendingPin);await options.onDurableState?.({...state,phase:next.phase});}});
    let stopping;
    return {url:app.url,health:()=>({...p.publicState(),hub:app.health(),storage:app.storageState()}),
      stop:()=>stopping??=(async()=>{
        try{const closed=await app.close();return await p.save('CLEAN',old.workspace,closed.checkpointPin);}
        finally{await p.close();}
      })()};
  }catch(e){try{await app?.close();}finally{await p.close();}throw e;}
}

export async function backupHubOperator(options){
  const p=await load(options);
  try{p.assertClean();const state=p.publicState();if(state.state!=='CLEAN')throw Error('NATIVE_REPLAY_REQUIRED_BEFORE_OPERATOR_BACKUP');distinct(options.providerDirectory,options.target);
    return {...await backupClosedHub({directory:state.workspace,target:options.target,checkpointPin:state.checkpointPin}),controlPin:state.controlPin,providerPin:state.providerPin};
  }finally{await p.close();}
}

export async function restoreHubOperator(options){
  const p=await load(options);
  try{p.assertClean(2);const state=p.publicState();distinct(options.providerDirectory,options.target);
    // Conservative two-phase control: a failed transfer is never silently CLEAN.
    await p.save('COPYING_RESTORE');
    const copied=await restoreClosedHub({backupDirectory:options.backupDirectory,target:options.target,backupPin:options.backupPin,checkpointPin:state.checkpointPin});
    const next=await p.save('RESTORED_UNVERIFIED',resolve(options.target),copied.checkpointPin);
    return {...next,restoreState:copied.state};
  }finally{await p.close();}
}
