// New reference format, never relabelled as a frozen BAARNE_REFERENCE_V1.
// Authority comes from a trusted finalized lifecycle view supplied by caller.
import {canonical,digest} from './application.mjs';
import {exact,edValid,LIFECYCLE_V3} from './lifecycle-v3.mjs';
export const REFERENCE_V3='BAARNE_SYNTHETIC_EPOCH_REFERENCE_V3';
export const referenceMessage=body=>REFERENCE_V3+'\nREFERENCE\n'+canonical(body);
export function acceptEpochReference(engine,raw,acceptedAt){
  if(engine?.config?.domain!==LIFECYCLE_V3||typeof raw!=='string'||Buffer.byteLength(raw)>4096||!Number.isSafeInteger(acceptedAt)||acceptedAt<engine.time)throw Error('INVALID_SCOPE_OR_SIZE');
  const record=JSON.parse(raw);exact(record,['body','signature']);const b=record.body;
  exact(b,['version','anchor','issuer','subject','epoch','issuedAt','expiresAt','nonce']);
  if(canonical(record)!==raw||b.version!==REFERENCE_V3||b.anchor!==engine.anchor)throw Error('WRONG_REFERENCE_DOMAIN');
  if(typeof b.issuer!=='string'||typeof b.subject!=='string'||!Object.hasOwn(engine.keys,b.issuer)||!Object.hasOwn(engine.keys,b.subject)||b.issuer===b.subject)throw Error('UNKNOWN_OR_SELF_REFERENCE');
  if(engine.state.members[b.issuer]?.status!=='ACTIVE')throw Error('ISSUER_NOT_ACTIVE');
  if(!Number.isSafeInteger(b.issuedAt)||b.issuedAt<0||b.issuedAt>acceptedAt||!(b.expiresAt===null||Number.isSafeInteger(b.expiresAt)&&b.expiresAt>acceptedAt)||typeof b.nonce!=='string'||!/^[0-9a-f]{64}$/.test(b.nonce))throw Error('INVALID_TIME_OR_NONCE');
  const key=engine.keys[b.issuer];if(b.epoch!==key.epoch||!edValid(key.signingKey,referenceMessage(b),record.signature))throw Error('REVOKED_OR_INVALID_KEY');
  if(Object.values(engine.referencesV3).some(entry=>{const old=JSON.parse(entry.record).body;return old.issuer===b.issuer&&old.epoch===b.epoch&&old.nonce===b.nonce;}))throw Error('REFERENCE_NONCE_REUSED');
  return {version:REFERENCE_V3,recordHash:digest(record),acceptedAt,issuer:b.issuer,epoch:b.epoch,authorityHash:digest({anchor:engine.anchor,height:engine.height,key}),membershipCreated:false};
}
