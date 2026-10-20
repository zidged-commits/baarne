// Network-disabled fixture signer; private keys never leave this process.
import {sign,randomBytes} from 'node:crypto';import {createInterface} from 'node:readline';
import {recoveryFixture,keyPair} from './membership-recovery-fixture.mjs';
import {canonical,digest} from './application.mjs';
import {enrollmentBody,enrollmentMessage,ENROLLMENT_VERSION,ENROLLMENT_PURPOSE} from './enrollment.mjs';
import {LIFECYCLE_V3,lifecycleMessage} from './lifecycle-v3.mjs';
import {REFERENCE_V3,referenceMessage} from './reference-authority-v3.mjs';
import {recoveryBody,recoveryMessage,possessionMessage} from './recovery.mjs';
import {initializeRecoveryLab,RECOVERY_DOMAIN} from './recovery.mjs';
import {validateReference,hashReference,portableSignatureMessage} from '../../packages/trust-protocol/src/index.ts';
import {makeMembershipEvent} from '../../packages/membership-state/src/index.mjs';
import {publicLifecycleGenesis} from './public-lifecycle-evidence.mjs';
const f=await recoveryFixture(Number(process.argv[2])),config={domain:LIFECYCLE_V3,mode:'ISOLATED_SYNTHETIC_LAB',membership:f.config.membership,maxAccounts:100},anchor=digest(config),next=keyPair();
const sig=(message,p)=>sign(null,Buffer.from(message),p.privateKey).toString('hex');
async function enroll(i){const p=f.people[i],body=enrollmentBody({version:ENROLLMENT_VERSION,purpose:ENROLLMENT_PURPOSE,network:config.membership.networkId,genesisHash:anchor,identity:p.identity,transactionKey:p.publicHex,recoveryKey:f.recoveryPairs[i].pub,nonce:randomBytes(32).toString('hex')});return {body,legacySignature:(await p.wallet.signMessage(enrollmentMessage(body,'LEGACY_IDENTITY'))).toLowerCase(),transactionSignature:sig(enrollmentMessage(body,'TRANSACTION_KEY'),p),recoverySignature:sig(enrollmentMessage(body,'RECOVERY_KEY'),f.recoveryPairs[i])};}
const bootstrap=await Promise.all([0,1,2].map(enroll)),registrations=await Promise.all([3,4].map(enroll));
function wrap(event,i,epoch=0,pair=f.people[i]){const body={domain:LIFECYCLE_V3,anchor,identity:f.people[i].identity,epoch,nonce:randomBytes(32).toString('hex'),event};return canonical({body,signature:sig(lifecycleMessage(body),pair)});}
const late=f.token('late-application'),events=f.txs.map((raw,i)=>({event:JSON.parse(raw).body.event,index:f.indices[i]}));
events.push({event:JSON.parse(f.tx('APPLICATION_OPENED',{applicationId:late,candidate:f.people[4].identity,invitationId:null},f.people[4])).body.event,index:4});
for(let i=0;i<3;i++){
  const p=f.people[i],reservationId=f.token('late-reservation'+i);
  events.push({event:JSON.parse(f.tx('REFERENCE_SLOT_RESERVED',{reservationId,issuer:p.identity,slot:1,applicationId:late},p)).body.event,index:i});
  const event=structuredClone(events[[4,6,8][i]].event);event.payload.reservationId=reservationId;event.payload.applicationId=late;event.payload.reference.record.subject=f.people[4].identity;event.payload.reference.record.nonce=f.token('late-reference'+i);events.push({event,index:i});
}
events.push({event:JSON.parse(f.tx('MEMBERSHIP_ACTIVATED',{applicationId:late,candidate:f.people[4].identity},f.people[4])).body.event,index:4});
const publicInput=await publicLifecycleGenesis({config,bootstrap});
console.log(JSON.stringify({...publicInput,people:f.people.map(p=>p.identity),eventCount:events.length}));
for await(const line of createInterface({input:process.stdin})){try{
  const q=JSON.parse(line);let tx;
  if(q.kind==='register')tx=canonical({kind:'REGISTER',record:registrations[q.index-3]});
  else if(q.kind==='event'){
    const {event:original,index}=events[q.index],event=structuredClone(original);
    if(event.eventType==='REFERENCE_RECORDED'){
      const p=f.people[index],record=validateReference({...event.payload.reference.record,issuedAt:q.time});event.payload.reference={record,authorization:{...event.payload.reference.authorization,recordHash:await hashReference(record),signature:(await p.wallet.signMessage(await portableSignatureMessage(record))).toLowerCase()}};
    }tx=wrap(makeMembershipEvent(event.networkId,event.eventType,event.occurredAt,event.payload),index);
  }else if(q.kind==='recover'){
    const p=f.people[0],state=initializeRecoveryLab({domain:RECOVERY_DOMAIN,network:config.membership.networkId,account:digest({identity:p.identity,genesisHash:anchor}),signingKey:p.publicHex,recoveryKey:f.recoveryPairs[0].pub}),body=recoveryBody(state,next.pub);
    tx=canonical({kind:'RECOVER',identity:p.identity,record:canonical({body,recoverySignature:sig(recoveryMessage(body),f.recoveryPairs[0]),newKeySignature:sig(possessionMessage(body),next)})});
  }else if(q.kind==='reference'){
    const body={version:REFERENCE_V3,anchor,issuer:f.people[0].identity,subject:f.people[4].identity,epoch:q.epoch,issuedAt:q.time,expiresAt:null,nonce:randomBytes(32).toString('hex')};tx=canonical({kind:'EPOCH_REFERENCE',record:canonical({body,signature:sig(referenceMessage(body),q.useOld?f.people[0]:q.epoch===0?f.people[0]:next)})});
  }else throw Error('UNKNOWN_COMMAND');
  console.log(JSON.stringify({ok:true,tx}));
}catch(e){console.log(JSON.stringify({ok:false,error:e.message}));}}
