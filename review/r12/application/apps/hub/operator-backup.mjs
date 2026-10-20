// Closed synthetic Hub byte backup, not an owner export or a live deployment.
// Transfer pin + checkpoint pin must be obtained separately from the backup.
import {createHash} from 'node:crypto';
import {lstat,readdir,mkdir,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {canonical} from '../../experiments/cometbft-fee-free-lab/application.mjs';
import {exact} from '../../experiments/cometbft-fee-free-lab/lifecycle-v3.mjs';
import {readBoundedRegularFile} from '../../experiments/cometbft-fee-free-lab/bounded-input.mjs';
import {acquireVaultLock} from '../../experiments/cometbft-fee-free-lab/windows-vault-lock.mjs';
const VERSION='BAARNE_SYNTHETIC_CLOSED_HUB_BACKUP_V1',MAX_BYTES=128*1024*1024,MAX_FILES=6140;
const sha=raw=>createHash('sha256').update(raw).digest('hex'),pin=p=>typeof p==='string'&&/^[0-9a-f]{64}$/.test(p);
const limit=name=>name==='operator-checkpoint.json'?1024*1024:/^(01|02)\/metadata\.json$/.test(name)?4096:/^(01|02)\/snapshot-[0-9]{4}\.json$/.test(name)?285000:/^pair\/pair-[0-9]{4}\.json$/.test(name)?7500000:0;
async function assertDirectory(path){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink())throw Error('INVALID_HUB_BACKUP_DIRECTORY');}
async function freshTarget(target,source){
  const dst=resolve(target),src=resolve(source),a=process.platform==='win32'?dst.toLowerCase():dst,b=process.platform==='win32'?src.toLowerCase():src;
  if(a===b||a.startsWith(b+'\\')||a.startsWith(b+'/'))throw Error('HUB_BACKUP_TARGET_INSIDE_SOURCE');
  try{await lstat(dst);}catch(e){if(e.code==='ENOENT')return dst;throw e;}throw Error('HUB_BACKUP_TARGET_EXISTS');
}
async function write(path,bytes){const f=await open(path,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}}
async function scan(root,backup){
  await assertDirectory(root);const files=new Map();let bytes=0;
  for(const name of await readdir(root)){
    if(name==='BACKUP_MANIFEST.json'&&backup)continue;
    if(name==='operator.lock'){
      if(backup)throw Error('UNEXPECTED_HUB_BACKUP_ENTRY');
      // The kernel lock is intentionally unreadable while this exporter owns it.
      const st=await lstat(join(root,name));if(!st.isFile()||st.isSymbolicLink()||st.size!==0)throw Error('INVALID_HUB_LOCK');continue;
    }
    const path=join(root,name);
    if(['01','02','pair'].includes(name)){
      await assertDirectory(path);for(const child of await readdir(path)){
        if(child==='writer.lock'){
          if(backup)throw Error('UNEXPECTED_HUB_BACKUP_ENTRY');
          await readBoundedRegularFile(join(path,child),0,'INVALID_HUB_LOCK','INVALID_HUB_LOCK');continue;
        }
        await add(name+'/'+child,join(path,child));
      }
      if(!files.has(name+'/'+(name==='pair'?'pair-0000.json':'metadata.json')))throw Error('INCOMPLETE_HUB_BACKUP_DIRECTORY');
    }else await add(name,path);
  }
  if(!files.has('operator-checkpoint.json'))throw Error('CLOSED_HUB_CHECKPOINT_REQUIRED');
  return files;
  async function add(name,path){const max=limit(name);if(!max)throw Error('UNCLEAN_OR_UNEXPECTED_HUB_BACKUP_ENTRY');const raw=await readBoundedRegularFile(path,max,'INVALID_HUB_BACKUP_FILE','HUB_BACKUP_FILE_QUOTA');bytes+=raw.length;if(files.size>=MAX_FILES||bytes>MAX_BYTES)throw Error('HUB_BACKUP_QUOTA');files.set(name,raw);}
}
async function copy(target,files){
  await mkdir(target,{mode:0o700});
  for(const folder of ['01','02','pair'])if([...files.keys()].some(p=>p.startsWith(folder+'/')))await mkdir(join(target,folder),{mode:0o700});
  for(const [name,bytes] of files)await write(join(target,name),bytes);
}
export async function backupClosedHub({directory,target,checkpointPin}){
  if(!pin(checkpointPin))throw Error('EXTERNAL_CHECKPOINT_PIN_REQUIRED');
  await assertDirectory(directory);const destination=await freshTarget(target,directory),lock=await acquireVaultLock(join(directory,'operator.lock'));
  try{
    lock.assertOwned();const files=await scan(directory,false);
    if(sha(files.get('operator-checkpoint.json'))!==checkpointPin)throw Error('OPERATOR_CHECKPOINT_PIN_MISMATCH');
    const manifest={version:VERSION,mode:'ISOLATED_SYNTHETIC_LAB',checkpointPin,files:[...files].map(([path,raw])=>({path,bytes:raw.length,sha256:sha(raw)})).sort((a,b)=>a.path<b.path?-1:1)};
    const raw=canonical(manifest);lock.assertOwned();await copy(destination,files);await write(join(destination,'BACKUP_MANIFEST.json'),raw);lock.assertOwned();
    return {backupPin:sha(raw),checkpointPin,fileCount:files.size,state:'ENCRYPTED_BYTE_BACKUP_NOT_OWNER_EXPORT',productionAuthorized:false};
  }finally{await lock.close();}
}
export async function restoreClosedHub({backupDirectory,target,backupPin,checkpointPin}){
  if(!pin(backupPin))throw Error('EXTERNAL_BACKUP_PIN_REQUIRED');
  if(!pin(checkpointPin))throw Error('EXTERNAL_EXPECTED_CHECKPOINT_PIN_REQUIRED');
  await assertDirectory(backupDirectory);const destination=await freshTarget(target,backupDirectory);
  const raw=await readBoundedRegularFile(join(backupDirectory,'BACKUP_MANIFEST.json'),2*1024*1024,'INVALID_HUB_BACKUP_MANIFEST','HUB_BACKUP_MANIFEST_QUOTA');
  if(sha(raw)!==backupPin)throw Error('HUB_BACKUP_PIN_MISMATCH');
  const manifest=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));exact(manifest,['version','mode','checkpointPin','files']);
  if(canonical(manifest)!==raw.toString('utf8')||manifest.version!==VERSION||manifest.mode!=='ISOLATED_SYNTHETIC_LAB'||!pin(manifest.checkpointPin)||!Array.isArray(manifest.files)||manifest.files.length<1||manifest.files.length>MAX_FILES)throw Error('INVALID_HUB_BACKUP_MANIFEST');
  if(manifest.checkpointPin!==checkpointPin)throw Error('UNEXPECTED_OR_STALE_HUB_CHECKPOINT');
  const files=await scan(backupDirectory,true);if(files.size!==manifest.files.length)throw Error('HUB_BACKUP_LENGTH_MISMATCH');
  const seen=new Set();for(const row of manifest.files){exact(row,['path','bytes','sha256']);if(typeof row.path!=='string'||!limit(row.path)||seen.has(row.path)||!Number.isSafeInteger(row.bytes)||row.bytes<0||!pin(row.sha256))throw Error('INVALID_HUB_BACKUP_MANIFEST');seen.add(row.path);const bytes=files.get(row.path);if(!bytes||bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw Error('HUB_BACKUP_CHECKSUM_MISMATCH');}
  if(sha(files.get('operator-checkpoint.json'))!==manifest.checkpointPin)throw Error('OPERATOR_CHECKPOINT_PIN_MISMATCH');
  await copy(destination,files);
  return {checkpointPin:manifest.checkpointPin,fileCount:files.size,state:'COPIED_NOT_REPLAY_VERIFIED',requires:'startPrivateHub with separately held operatorKey and checkpoint pin; native signed replay before listening',productionAuthorized:false};
}
