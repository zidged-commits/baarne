// Synthetic Windows operator checkpoint. Caller holds the key and pin separately.
// An unclean stop is deliberately NOT an automatic recovery authorization.
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {lstat,open,readdir,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {canonical} from '../../experiments/cometbft-fee-free-lab/application.mjs';
import {exact} from '../../experiments/cometbft-fee-free-lab/lifecycle-v3.mjs';
import {readBoundedRegularFile} from '../../experiments/cometbft-fee-free-lab/bounded-input.mjs';
import {acquireVaultLock} from '../../experiments/cometbft-fee-free-lab/windows-vault-lock.mjs';
export const OPERATOR_CHECKPOINT_VERSION='BAARNE_SYNTHETIC_HUB_CHECKPOINT_V1';
const FILE='operator-checkpoint.json',ACTIVE='operator-active.json',TEMP='operator-checkpoint.pending';
const MAX=1024*1024,sha=raw=>createHash('sha256').update(raw).digest('hex');
const header={version:OPERATOR_CHECKPOINT_VERSION,mode:'ISOLATED_SYNTHETIC_LAB'};
const encoded=b=>b.toString('base64');
function decode(value,n){if(typeof value!=='string'||value.length>MAX)throw Error('INVALID_OPERATOR_CHECKPOINT');const b=Buffer.from(value,'base64');if(encoded(b)!==value||(n!==undefined&&b.length!==n))throw Error('INVALID_OPERATOR_CHECKPOINT');return b;}
async function exclusive(path,raw){const file=await open(path,'wx',0o600);try{await file.writeFile(raw);await file.sync();}finally{await file.close();}}
export async function operatorCheckpoint({directory,key,resumePin,recover=false,pendingPin=null}){
  if(!Buffer.isBuffer(key)||key.length!==32)throw Error('EXTERNAL_SYNTHETIC_OPERATOR_KEY_REQUIRED');
  if(resumePin!==undefined&&(typeof resumePin!=='string'||!/^[0-9a-f]{64}$/.test(resumePin)))throw Error('EXTERNAL_CHECKPOINT_PIN_REQUIRED');
  if(typeof recover!=='boolean'||pendingPin!==null&&(typeof pendingPin!=='string'||!/^[0-9a-f]{64}$/.test(pendingPin))||pendingPin&&!recover||recover&&resumePin===undefined)throw Error('EXPLICIT_PINNED_RECOVERY_REQUIRED');
  const root=await lstat(directory);if(!root.isDirectory()||root.isSymbolicLink())throw Error('INVALID_OPERATOR_DIRECTORY');
  const lock=await acquireVaultLock(join(directory,'operator.lock')),secret=Buffer.from(key);
  let active=false,finished=false,currentPin=resumePin,intentPin=pendingPin,lastStateDigest;
  const intentHeader={version:'BAARNE_SYNTHETIC_HUB_INTENT_V1',mode:'ISOLATED_SYNTHETIC_LAB'},INTENT='operator-intent.json';
  function seal(value,aad){
    const plain=Buffer.from(canonical(value));if(plain.length>700000){plain.fill(0);throw Error('OPERATOR_CHECKPOINT_QUOTA');}
    try{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(Buffer.from(canonical(aad)));const data=Buffer.concat([cipher.update(plain),cipher.final()]);return canonical({header:aad,iv:encoded(iv),tag:encoded(cipher.getAuthTag()),data:encoded(data)});}finally{plain.fill(0);}
  }
  async function readSealed(name,expected,aad){
    const raw=await readBoundedRegularFile(join(directory,name),MAX,'INVALID_OPERATOR_CHECKPOINT','OPERATOR_CHECKPOINT_QUOTA');
    if(sha(raw)!==expected)throw Error('OPERATOR_CHECKPOINT_PIN_MISMATCH');
    const row=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));exact(row,['header','iv','tag','data']);
    if(canonical(row)!==raw.toString('utf8')||canonical(row.header)!==canonical(aad))throw Error('INVALID_OPERATOR_CHECKPOINT');
    try{const decipher=createDecipheriv('aes-256-gcm',secret,decode(row.iv,12));decipher.setAAD(Buffer.from(canonical(aad)));decipher.setAuthTag(decode(row.tag,16));const plain=Buffer.concat([decipher.update(decode(row.data)),decipher.final()]);try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(plain));}finally{plain.fill(0);}}catch{throw Error('OPERATOR_CHECKPOINT_AUTHENTICATION_FAILED');}
  }
  try{
    const entries=await readdir(directory);
    const allowed=resumePin===undefined?['operator.lock']:['operator.lock',FILE,'01','02','pair',...(recover?[ACTIVE,INTENT,TEMP]:[])];
    if((entries.includes(ACTIVE)||entries.includes(INTENT)||entries.includes(TEMP))&&!recover)throw Error('UNCLEAN_OPERATOR_STOP_REQUIRES_REVIEW');
    if(entries.some(name=>!allowed.includes(name)))throw Error('UNEXPECTED_OPERATOR_ENTRY');
    let state=null,intent=null;
    if(resumePin!==undefined){
      if(pendingPin){
        intent=await readSealed(INTENT,pendingPin,intentHeader);exact(intent,['checkpointPin','state','ownerKey','request']);
        if(intent.checkpointPin!==resumePin||typeof intent.ownerKey!=='string'||!/^[0-9a-f]{64}$/.test(intent.ownerKey))throw Error('WRONG_OPERATOR_RECOVERY_INTENT');state=intent.state;
        // Native replay determines whether this pinned intent has a single tail.
        // A possibly later unanchored cache snapshot is not recovery authority.
      }else state=await readSealed(FILE,resumePin,header);
      if(!pendingPin)lastStateDigest=sha(canonical(state));
    }
    const persist=async value=>{
      if(finished||!active)throw Error('OPERATOR_CHECKPOINT_CLOSED');lock.assertOwned();
      if((await readdir(directory)).includes(TEMP))throw Object.assign(Error('OPERATOR_CHECKPOINT_PENDING_REQUIRES_REVIEW'),{code:'EEXIST'});
      const digest=sha(canonical(value));if(digest===lastStateDigest&&currentPin)return {checkpointPin:currentPin};
      const raw=seal(value,header);await exclusive(join(directory,TEMP),raw);lock.assertOwned();await rename(join(directory,TEMP),join(directory,FILE));currentPin=sha(raw);lastStateDigest=digest;return {checkpointPin:currentPin};
    };
    return {state,intent,recovering:recover,hadActive:entries.includes(ACTIVE),hasIntent:entries.includes(INTENT),hasTemporary:entries.includes(TEMP),
      publicState:()=>({checkpointPin:currentPin,pendingPin:intentPin}),
      assertOwned:()=>lock.assertOwned(),
      async activate(){if(active||finished)throw Error('OPERATOR_CHECKPOINT_ALREADY_ACTIVE');lock.assertOwned();if(entries.includes(ACTIVE)&&recover)await readBoundedRegularFile(join(directory,ACTIVE),4096,'INVALID_OPERATOR_ACTIVE','INVALID_OPERATOR_ACTIVE');else await exclusive(join(directory,ACTIVE),canonical(header));active=true;},
      persist,
      async clearRecoveryTemporary(){if(!recover)throw Error('EXPLICIT_PINNED_RECOVERY_REQUIRED');lock.assertOwned();if(entries.includes(TEMP)){await readBoundedRegularFile(join(directory,TEMP),MAX,'INVALID_OPERATOR_CHECKPOINT','OPERATOR_CHECKPOINT_QUOTA');await unlink(join(directory,TEMP));}},
      async prepare(state,ownerKey,request){
        if(!active||finished||!currentPin)throw Error('OPERATOR_CHECKPOINT_CLOSED');lock.assertOwned();
        const raw=seal({checkpointPin:currentPin,state,ownerKey,request},intentHeader);await exclusive(join(directory,INTENT),raw);intentPin=sha(raw);return {checkpointPin:currentPin,pendingPin:intentPin};
      },
      async clearIntent(){lock.assertOwned();try{await unlink(join(directory,INTENT));}catch(e){if(e.code!=='ENOENT')throw e;}intentPin=null;},
      async finish(value){
        if(intentPin)throw Error('UNRESOLVED_OPERATOR_INTENT');const result=await persist(value);
        lock.assertOwned();await unlink(join(directory,ACTIVE));active=false;finished=true;
        return {...result,state:'CLEANLY_CLOSED',productionAuthorized:false};
      },
      async close(){secret.fill(0);await lock.close();}
    };
  }catch(e){secret.fill(0);await lock.close();throw e;}
}
