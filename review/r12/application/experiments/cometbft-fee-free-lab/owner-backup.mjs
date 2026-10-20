// Synthetic-only key-loss experiment; no real key files or production vault.
import {createPrivateKey,createPublicKey,createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
import {Wallet} from 'ethers';
import {canonical} from './application.mjs';
export const BACKUP_VERSION='BAARNE_OWNER_LEGACY_BACKUP_LAB_V1';
export const SYNTHETIC_MODE='ISOLATED_SYNTHETIC_LAB';
const hex=(value,n)=>typeof value==='string'&&new RegExp('^[0-9a-f]{'+n*2+'}$').test(value);
const exact=(v,ks)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==ks.sort().join(','))throw Error('INVALID_FIELDS');};
export function validateBackupScope(input){
  exact(input,['mode','network','account','genesisHash','identity','recoveryKey']);
  if(input.mode!==SYNTHETIC_MODE||typeof input.network!=='string'||!/^baarne:[a-z0-9-]{3,64}$/.test(input.network)||
    !hex(input.account,32)||!hex(input.genesisHash,32)||!hex(input.recoveryKey,32)||
    typeof input.identity!=='string'||!/^evm-eoa:0x[0-9a-f]{40}$/.test(input.identity)||/^evm-eoa:0x0+$/.test(input.identity))throw Error('INVALID_SCOPE');
  return structuredClone(input);
}
export function recoveryPublicKey(seed){
  if(!Buffer.isBuffer(seed)||seed.length!==32)throw Error('INVALID_RECOVERY_ROOT');
  const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
  return createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32).toString('hex');
}
function root(seed,scope){if(recoveryPublicKey(seed)!==scope.recoveryKey)throw Error('WRONG_RECOVERY_ROOT');}
function walletIdentity(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length!==32)throw Error('INVALID_LEGACY_KEY');
  try{return 'evm-eoa:'+new Wallet('0x'+bytes.toString('hex')).address.toLowerCase();}catch{throw Error('INVALID_LEGACY_KEY');}
}
function derive(seed,salt,scope){return Buffer.from(hkdfSync('sha256',seed,salt,
  Buffer.from(BACKUP_VERSION+'\nENCRYPTION_KEY\n'+canonical(scope)),32));}
export function sealLegacyKey(scopeInput,recoverySeed,legacyKey){
  const scope=validateBackupScope(scopeInput);root(recoverySeed,scope);
  if(walletIdentity(legacyKey)!==scope.identity)throw Error('WRONG_LEGACY_IDENTITY');
  const salt=randomBytes(16),iv=randomBytes(12),key=derive(recoverySeed,salt,scope);
  try{
    const cipher=createCipheriv('aes-256-gcm',key,iv,{authTagLength:16});
    cipher.setAAD(Buffer.from(canonical({version:BACKUP_VERSION,scope,salt:salt.toString('hex'),iv:iv.toString('hex')})));
    const ciphertext=Buffer.concat([cipher.update(legacyKey),cipher.final()]);
    return canonical({version:BACKUP_VERSION,scope,salt:salt.toString('hex'),iv:iv.toString('hex'),
      ciphertext:ciphertext.toString('hex'),tag:cipher.getAuthTag().toString('hex')});
  }finally{key.fill(0);}
}
export function restoreLegacyKey(raw,scopeInput,recoverySeed){
  const scope=validateBackupScope(scopeInput);root(recoverySeed,scope);
  if(typeof raw!=='string'||Buffer.byteLength(raw)>4096)throw Error('INVALID_BACKUP');
  let backup;try{backup=JSON.parse(raw);}catch{throw Error('INVALID_BACKUP');}
  exact(backup,['version','scope','salt','iv','ciphertext','tag']);
  if(backup.version!==BACKUP_VERSION||canonical(backup)!==raw||canonical(backup.scope)!==canonical(scope)||
    !hex(backup.salt,16)||!hex(backup.iv,12)||!hex(backup.ciphertext,32)||!hex(backup.tag,16))throw Error('INVALID_BACKUP_OR_SCOPE');
  const key=derive(recoverySeed,Buffer.from(backup.salt,'hex'),scope);let plaintext;
  try{
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(backup.iv,'hex'),{authTagLength:16});
    decipher.setAAD(Buffer.from(canonical({version:BACKUP_VERSION,scope,salt:backup.salt,iv:backup.iv})));
    decipher.setAuthTag(Buffer.from(backup.tag,'hex'));
    plaintext=Buffer.concat([decipher.update(Buffer.from(backup.ciphertext,'hex')),decipher.final()]);
    if(walletIdentity(plaintext)!==scope.identity)throw Error('WRONG_LEGACY_IDENTITY');
    return plaintext;
  }catch{plaintext?.fill(0);throw Error('BACKUP_AUTHENTICATION_FAILED');}finally{key.fill(0);}
}
