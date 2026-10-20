// Synthetic owner-authenticated encrypted storage; no OS/hardware key custody claim.
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {open,lstat,readFile} from 'node:fs/promises';
import {canonical,digest} from './application.mjs';
import {exact,edValid} from './lifecycle-v3.mjs';
import {validateTwinProfile,getDiscoveryProfile,DISCOVERY_FIELDS} from '../../packages/behavioral-twin/src/index.mjs';
export const VAULT_VERSION='BAARNE_SYNTHETIC_PRIVATE_VAULT_V1';
export const vaultMessage=body=>VAULT_VERSION+'\nOWNER_COMMAND\n'+canonical(body);
export const accessMessage=body=>VAULT_VERSION+'\nREADER_REQUEST\n'+canonical(body);
const pub=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const size=v=>Buffer.byteLength(canonical(v));
export function createVault(scope,ownerKey,profile){
  exact(scope,['mode','network','account']);
  if(scope.mode!=='ISOLATED_SYNTHETIC_LAB'||typeof scope.network!=='string'||!/^baarne:[a-z0-9-]{3,64}$/.test(scope.network)||typeof scope.account!=='string'||!/^[0-9a-f]{64}$/.test(scope.account)||!pub(ownerKey))throw Error('INVALID_SCOPE');
  const p=validateTwinProfile(profile);if(size(p)>32768)throw Error('PROFILE_TOO_LARGE');
  return {version:VAULT_VERSION,scope:structuredClone(scope),ownerKey,revision:0,profile:structuredClone(p),grants:{},deleted:false};
}
export function applyVaultCommand(state,record){
  exact(record,['body','signature']);const b=record.body;exact(b,['version','scope','revision','action','payload']);
  if(b.version!==VAULT_VERSION||canonical(b.scope)!==canonical(state.scope)||b.revision!==state.revision+1||!edValid(state.ownerKey,vaultMessage(b),record.signature))throw Error('UNAUTHORIZED_OR_STALE_COMMAND');
  if(state.deleted)throw Error('VAULT_DELETED');
  const next=structuredClone(state);
  if(b.action==='PROFILE'){
    const p=validateTwinProfile(b.payload);if(p.userId!==state.profile.userId||p.updatedAt<state.profile.updatedAt||size(p)>32768)throw Error('INVALID_PROFILE_UPDATE');next.profile=structuredClone(p);
  }else if(b.action==='GRANT'){
    exact(b.payload,['id','readerKey','purpose','fields','expiresAt']);const p=b.payload;
    if(typeof p.id!=='string'||!/^[0-9a-f]{64}$/.test(p.id)||!pub(p.readerKey)||p.readerKey===state.ownerKey||p.purpose!=='DISCOVERY'||!Array.isArray(p.fields)||p.fields.length<1||p.fields.length>DISCOVERY_FIELDS.length||new Set(p.fields).size!==p.fields.length||p.fields.some(f=>!DISCOVERY_FIELDS.includes(f))||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<0||Object.hasOwn(next.grants,p.id)||Object.keys(next.grants).length>=100)throw Error('INVALID_GRANT');next.grants[p.id]=structuredClone(p);
  }else if(b.action==='REVOKE'){
    exact(b.payload,['id']);if(!Object.hasOwn(next.grants,b.payload.id))throw Error('UNKNOWN_GRANT');delete next.grants[b.payload.id];
  }else if(b.action==='DELETE'){
    exact(b.payload,[]);next.deleted=true;next.profile=null;next.grants={};
  }else throw Error('UNSUPPORTED_ACTION');
  next.revision=b.revision;return next;
}
export function readVault(state,request,now){
  exact(request,['body','signature']);const b=request.body;exact(b,['version','scope','revision','purpose','grantId','nonce']);
  if(state.deleted||b.version!==VAULT_VERSION||canonical(b.scope)!==canonical(state.scope)||b.revision!==state.revision||typeof b.nonce!=='string'||!/^[0-9a-f]{64}$/.test(b.nonce)||!Number.isSafeInteger(now)||now<0)throw Error('INVALID_ACCESS');
  if(b.purpose==='OWNER_EXPORT'&&b.grantId===null&&edValid(state.ownerKey,accessMessage(b),request.signature))return structuredClone(state.profile);
  const grant=typeof b.grantId==='string'&&Object.hasOwn(state.grants,b.grantId)?state.grants[b.grantId]:null;
  if(!grant||b.purpose!==grant.purpose||now>=grant.expiresAt||!edValid(grant.readerKey,accessMessage(b),request.signature))throw Error('ACCESS_DENIED');
  const profile=getDiscoveryProfile(state.profile);if(!profile.discoverable)return null;
  // Both profile-level field consent and this particular reader grant must allow disclosure.
  return Object.fromEntries(grant.fields.map(f=>[f,structuredClone(profile.attributes[f])]));
}
// Metadata-only owner access survives a logical tombstone; it never exports profile.
export function readVaultOwnerState(state,request){exact(request,['body','signature']);const b=request.body;exact(b,['version','scope','revision','purpose','grantId','nonce']);if(b.version!==VAULT_VERSION||canonical(b.scope)!==canonical(state.scope)||b.revision!==state.revision||b.purpose!=='OWNER_STATUS'||b.grantId!==null||typeof b.nonce!=='string'||!/^[0-9a-f]{64}$/.test(b.nonce)||!edValid(state.ownerKey,accessMessage(b),request.signature))throw Error('INVALID_OWNER_STATE_ACCESS');return {deleted:state.deleted};}
const snapshotHash=raw=>createHash('sha256').update(raw).digest('hex');
export function sealVault(state,key){
  if(!Buffer.isBuffer(key)||key.length!==32||size(state)>65536)throw Error('INVALID_KEY_OR_SIZE');
  const iv=randomBytes(12),header={version:VAULT_VERSION,scope:state.scope,revision:state.revision,iv:iv.toString('hex')};
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(canonical(header)));
  const ciphertext=Buffer.concat([cipher.update(canonical(state),'utf8'),cipher.final()]);
  const raw=canonical({header,ciphertext:ciphertext.toString('hex'),tag:cipher.getAuthTag().toString('hex')});return {raw,pin:snapshotHash(raw)};
}
export function openVault(raw,key,trusted){
  try{
    exact(trusted,['pin','scope','revision','ownerKey']);
    if(typeof raw!=='string'||Buffer.byteLength(raw)>140000||!Buffer.isBuffer(key)||key.length!==32||snapshotHash(raw)!==trusted.pin)throw Error();
    const d=JSON.parse(raw);exact(d,['header','ciphertext','tag']);exact(d.header,['version','scope','revision','iv']);
    if(canonical(d)!==raw||d.header.version!==VAULT_VERSION||canonical(d.header.scope)!==canonical(trusted.scope)||d.header.revision!==trusted.revision||typeof d.header.iv!=='string'||!/^[0-9a-f]{24}$/.test(d.header.iv)||typeof d.tag!=='string'||!/^[0-9a-f]{32}$/.test(d.tag)||typeof d.ciphertext!=='string'||!/^([0-9a-f]{2})+$/.test(d.ciphertext))throw Error();
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(d.header.iv,'hex'));decipher.setAAD(Buffer.from(canonical(d.header)));decipher.setAuthTag(Buffer.from(d.tag,'hex'));
    const plaintext=Buffer.concat([decipher.update(Buffer.from(d.ciphertext,'hex')),decipher.final()]);let s;try{s=JSON.parse(plaintext.toString('utf8'));}finally{plaintext.fill(0);}
    exact(s,['version','scope','ownerKey','revision','profile','grants','deleted']);
    if(s.version!==VAULT_VERSION||s.ownerKey!==trusted.ownerKey||s.revision!==trusted.revision||canonical(s.scope)!==canonical(trusted.scope)||typeof s.deleted!=='boolean')throw Error();
    if(s.deleted){if(s.profile!==null||Object.keys(s.grants).length)throw Error();}else validateTwinProfile(s.profile);
    return s;
  }catch{throw Error('INVALID_ENCRYPTED_SNAPSHOT');}
}
export async function saveVaultExclusive(path,state,key){
  const sealed=sealVault(state,key),file=await open(path,'wx',0o600);
  try{await file.writeFile(sealed.raw,'utf8');await file.sync();}finally{await file.close();}return {pin:sealed.pin,scope:structuredClone(state.scope),revision:state.revision,ownerKey:state.ownerKey};
}
export async function loadVault(path,key,trusted){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>140000)throw Error('INVALID_SNAPSHOT_FILE');return openVault(await readFile(path,'utf8'),key,trusted);}
