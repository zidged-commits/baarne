// Ownership/possession proof only. Does not create membership or authorize Genesis.
import {createPublicKey,verify} from 'node:crypto';
import {evmEoaVerifier} from '../../packages/identity/src/evm-eoa.ts';
import {canonical,digest} from './application.mjs';
import {createRecoverableExecution} from './membership-recovery.mjs';
export const ENROLLMENT_VERSION='BAARNE_SYNTHETIC_KEY_ENROLLMENT_V1';
export const ENROLLMENT_PURPOSE='BIND_TRANSACTION_AND_OWNER_RECOVERY_KEYS';
const exact=(v,ks)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==ks.sort().join(','))throw Error('INVALID_FIELDS');};
export function enrollmentBody(input){
  exact(input,['version','purpose','network','genesisHash','identity','transactionKey','recoveryKey','nonce']);
  if(input.version!==ENROLLMENT_VERSION||input.purpose!==ENROLLMENT_PURPOSE||
    typeof input.network!=='string'||!/^baarne:[a-z0-9-]{3,64}$/.test(input.network)||
    typeof input.identity!=='string'||!/^evm-eoa:0x[0-9a-f]{40}$/.test(input.identity)||/^evm-eoa:0x0+$/.test(input.identity)||
    ['genesisHash','transactionKey','recoveryKey','nonce'].some(k=>typeof input[k]!=='string'||!/^[0-9a-f]{64}$/.test(input[k]))||
    input.transactionKey===input.recoveryKey)throw Error('INVALID_ENROLLMENT');
  return structuredClone(input);
}
export const enrollmentMessage=(body,role)=>{
  if(!['LEGACY_IDENTITY','TRANSACTION_KEY','RECOVERY_KEY'].includes(role))throw Error('INVALID_ROLE');
  return ENROLLMENT_VERSION+'\n'+role+'\n'+canonical(enrollmentBody(body));
};
function possession(key,message,signature){
  if(typeof signature!=='string'||!/^[0-9a-f]{128}$/.test(signature))return false;
  return verify(null,Buffer.from(message),createPublicKey({key:Buffer.from('302a300506032b6570032100'+key,'hex'),format:'der',type:'spki'}),Buffer.from(signature,'hex'));
}
export async function reviewGenesisEnrollments(configInput,recordsInput){
  // Reviewed application validator supplies the exact V2 configuration; this
  // check requires an ownership record for every configured public binding.
  const config=structuredClone(configInput),records=structuredClone(recordsInput);
  createRecoverableExecution(config);
  if(!Array.isArray(records)||records.length>16||!config.signers||!config.recoveryKeys||!config.membership||
    config.domain!=='BAARNE_FEE_FREE_MEMBERSHIP_RECOVERY_LAB_V2')throw Error('INVALID_CONFIG');
  const expectedHash=digest(config),seen=new Set(),nonces=new Set(),keys=new Set(),receipts=[];
  for(const record of records){
    if(Buffer.byteLength(canonical(record))>4096)throw Error('ENROLLMENT_TOO_LARGE');
    exact(record,['body','legacySignature','transactionSignature','recoverySignature']);const b=enrollmentBody(record.body);
    if(typeof record.legacySignature!=='string'||!/^0x[0-9a-f]{130}$/.test(record.legacySignature))throw Error('LEGACY_OWNER_NOT_PROVEN');
    if(b.genesisHash!==expectedHash||b.network!==config.membership.networkId||
      !Object.hasOwn(config.signers,b.identity)||config.signers[b.identity]!==b.transactionKey||config.recoveryKeys[b.identity]!==b.recoveryKey)throw Error('ENROLLMENT_SCOPE_MISMATCH');
    if(seen.has(b.identity)||nonces.has(b.nonce)||keys.has(b.transactionKey)||keys.has(b.recoveryKey))throw Error('DUPLICATE_BINDING');
    if(await evmEoaVerifier.verify(enrollmentMessage(b,'LEGACY_IDENTITY'),record.legacySignature,b.identity)!=='VALID')throw Error('LEGACY_OWNER_NOT_PROVEN');
    if(!possession(b.transactionKey,enrollmentMessage(b,'TRANSACTION_KEY'),record.transactionSignature)||
      !possession(b.recoveryKey,enrollmentMessage(b,'RECOVERY_KEY'),record.recoverySignature))throw Error('KEY_POSSESSION_NOT_PROVEN');
    seen.add(b.identity);nonces.add(b.nonce);keys.add(b.transactionKey);keys.add(b.recoveryKey);
    receipts.push({identity:b.identity,recordHash:digest(record),status:'OWNERSHIP_AND_POSSESSION_PROVEN'});
  }
  if(seen.size!==Object.keys(config.signers).length||Object.keys(config.recoveryKeys).some(id=>!seen.has(id)))throw Error('MISSING_ENROLLMENT');
  return {version:ENROLLMENT_VERSION,genesisHash:expectedHash,receipts,livePilotAuthorized:false};
}
