import {generateKeyPairSync,sign} from 'node:crypto';
import {fixture} from './membership-fixture.mjs';
import {canonical,digest} from './application.mjs';
import {RECOVERABLE_MEMBERSHIP_DOMAIN,initialKeyStates} from './membership-recovery.mjs';
import {recoveryBody,recoveryMessage,possessionMessage} from './recovery.mjs';
export function keyPair(){const p=generateKeyPairSync('ed25519');return {...p,pub:p.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex')};}
export async function recoveryFixture(createdAt=1000){
  const f=await fixture(createdAt),recoveryPairs=f.people.map(()=>keyPair()),next=keyPair();
  const config={...f.config,domain:RECOVERABLE_MEMBERSHIP_DOMAIN,
    recoveryKeys:Object.fromEntries(f.people.map((p,i)=>[p.identity,recoveryPairs[i].pub]))};
  function wrap(raw,index,epoch=0,pair=f.people[index]){
    const old=JSON.parse(raw).body,body={...old,domain:RECOVERABLE_MEMBERSHIP_DOMAIN,genesisHash:digest(config),epoch};
    return canonical({body,id:digest(body),signature:sign(null,Buffer.from(canonical(body)),pair.privateKey).toString('hex')});
  }
  const indices=[0,1,3,0,0,1,1,2,2,3],txs=f.txs.map((raw,i)=>wrap(raw,indices[i]));
  function recoveryTx(identity=f.people[3].identity,newKey=next,recoverer=recoveryPairs[3],state=initialKeyStates(config)[identity]){
    const body=recoveryBody(state,newKey.pub),record=canonical({body,
      recoverySignature:sign(null,Buffer.from(recoveryMessage(body)),recoverer.privateKey).toString('hex'),
      newKeySignature:sign(null,Buffer.from(possessionMessage(body)),newKey.privateKey).toString('hex')});
    return canonical({kind:'KEY_RECOVERY',identity,record});
  }
  const d=f.people[3],resign=f.tx('MEMBERSHIP_RESIGNED',{member:d.identity},d);
  return {...f,config,txs,wrap,indices,recoveryPairs,next,recoveryTx,
    blocks:[{height:1,time:createdAt+10,txs}],oldResignation:wrap(resign,3),newResignation:wrap(resign,3,1,next)};
}
