// Isolated account-key recovery candidate, not installed in membership or Hub.
import {createPublicKey, verify} from 'node:crypto';
import {canonical,digest} from './application.mjs';
export const RECOVERY_DOMAIN='BAARNE_OWNER_RECOVERY_LAB_V1';
const key=k=>typeof k==='string'&&/^[0-9a-f]{64}$/.test(k);
const exact=(v,ks)=>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==ks.sort().join(','))throw Error('INVALID_FIELDS');
};
const seal=body=>({...body,stateHash:digest(body)});
export function initializeRecoveryLab(input) {
  exact(input,['domain','network','account','signingKey','recoveryKey']);
  if(input.domain!==RECOVERY_DOMAIN||typeof input.network!=='string'||!/^baarne:[a-z0-9-]{3,64}$/.test(input.network)||
    !key(input.account)||!key(input.signingKey)||!key(input.recoveryKey)||input.signingKey===input.recoveryKey)throw Error('INVALID_GENESIS');
  return seal({...structuredClone(input),genesisHash:digest(input),epoch:0,head:null});
}
function stateBody(state) {
  exact(state,['domain','network','account','signingKey','recoveryKey','genesisHash','epoch','head','stateHash']);
  const {stateHash,...body}=state;
  if(body.domain!==RECOVERY_DOMAIN||!key(body.account)||!key(body.signingKey)||!key(body.recoveryKey)||
    typeof body.network!=='string'||!/^baarne:[a-z0-9-]{3,64}$/.test(body.network)||
    body.signingKey===body.recoveryKey||!key(body.genesisHash)||!Number.isSafeInteger(body.epoch)||body.epoch<0||
    !(body.head===null||key(body.head))||(body.epoch===0)!==(body.head===null)||digest(body)!==stateHash)throw Error('INVALID_STATE');
  return body;
}
export function recoveryBody(state,newSigningKey) {
  const s=stateBody(state);
  if(!key(newSigningKey)||newSigningKey===s.signingKey||newSigningKey===s.recoveryKey)throw Error('INVALID_NEW_KEY');
  return {domain:RECOVERY_DOMAIN,network:s.network,account:s.account,genesisHash:s.genesisHash,
    epoch:s.epoch+1,previousHead:s.head,newSigningKey};
}
export const recoveryMessage=body=>RECOVERY_DOMAIN+'\nRECOVERY\n'+canonical(body);
export const possessionMessage=body=>RECOVERY_DOMAIN+'\nNEW_KEY_POSSESSION\n'+canonical(body);
function signatureValid(pub,message,sig) {
  if(typeof sig!=='string'||!/^[0-9a-f]{128}$/.test(sig))return false;
  const publicKey=createPublicKey({key:Buffer.from('302a300506032b6570032100'+pub,'hex'),type:'spki',format:'der'});
  return verify(null,Buffer.from(message),publicKey,Buffer.from(sig,'hex'));
}
export function applyRecoveryLab(state,raw) {
  const unchanged=status=>({status,state});
  try {
    const s=stateBody(state);
    if(typeof raw!=='string'||Buffer.byteLength(raw)>2048)throw Error('INVALID_SIZE');
    const record=JSON.parse(raw);exact(record,['body','recoverySignature','newKeySignature']);
    exact(record.body,['domain','network','account','genesisHash','epoch','previousHead','newSigningKey']);
    if(canonical(record)!==raw)throw Error('NONCANONICAL');
    const expected=recoveryBody(state,record.body.newSigningKey);
    if(canonical(record.body)!==canonical(expected))throw Error('STALE_OR_WRONG_SCOPE');
    if(!signatureValid(s.recoveryKey,recoveryMessage(expected),record.recoverySignature))throw Error('INVALID_RECOVERY_SIGNATURE');
    if(!signatureValid(expected.newSigningKey,possessionMessage(expected),record.newKeySignature))throw Error('NEW_KEY_NOT_PROVEN');
    return {status:'RECOVERED',state:seal({...s,signingKey:expected.newSigningKey,epoch:expected.epoch,head:digest(record)})};
  }catch(e){return unchanged(e.message);}
}
