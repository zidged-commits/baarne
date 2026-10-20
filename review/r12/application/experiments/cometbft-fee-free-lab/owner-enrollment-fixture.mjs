import {sign,randomBytes} from 'node:crypto';
import {recoveryFixture} from './membership-recovery-fixture.mjs';
import {initialKeyStates} from './membership-recovery.mjs';
import {digest} from './application.mjs';
import {ENROLLMENT_VERSION,ENROLLMENT_PURPOSE,enrollmentMessage} from './enrollment.mjs';
export async function enrollmentRecords(f){
  const records=[];
  for(let i=0;i<f.people.length;i++){
    const p=f.people[i],body={version:ENROLLMENT_VERSION,purpose:ENROLLMENT_PURPOSE,network:f.config.membership.networkId,
      genesisHash:digest(f.config),identity:p.identity,transactionKey:p.publicHex,recoveryKey:f.recoveryPairs[i].pub,
      nonce:randomBytes(32).toString('hex')};
    records.push({body,legacySignature:(await p.wallet.signMessage(enrollmentMessage(body,'LEGACY_IDENTITY'))).toLowerCase(),
      transactionSignature:sign(null,Buffer.from(enrollmentMessage(body,'TRANSACTION_KEY')),p.privateKey).toString('hex'),
      recoverySignature:sign(null,Buffer.from(enrollmentMessage(body,'RECOVERY_KEY')),f.recoveryPairs[i].privateKey).toString('hex')});
  }
  return records;
}
export async function ownerFixture(){
  const f=await recoveryFixture(),records=await enrollmentRecords(f),keys=initialKeyStates(f.config),p=f.people[0];
  // Synthetic test recovery seed only, never load a user file or emit it.
  const seed=f.recoveryPairs[0].privateKey.export({format:'der',type:'pkcs8'}).subarray(-32);
  const scope={mode:'ISOLATED_SYNTHETIC_LAB',network:f.config.membership.networkId,account:keys[p.identity].account,
    genesisHash:digest(f.config),identity:p.identity,recoveryKey:f.recoveryPairs[0].pub};
  return {...f,records,seed,scope,legacyKey:Buffer.from(p.wallet.privateKey.slice(2),'hex')};
}
