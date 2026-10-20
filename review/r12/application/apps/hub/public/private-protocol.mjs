// Browser-native protocol and key-provider interface. No plaintext key persistence.
export const HUB_PRIVATE_VERSION='BAARNE_LOCAL_SYNTHETIC_HUB_V1';
export const VAULT='BAARNE_SYNTHETIC_PRIVATE_VAULT_V1';
export const PAIR='BAARNE_SYNTHETIC_PRIVATE_INTRODUCTION_V1';
export const HANDOFF='BAARNE_SYNTHETIC_PROFILE_HANDOFF_V1';
export const NOTICE='BAARNE_SYNTHETIC_SOURCE_NOTICE_V1';
export const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const bytes=v=>new TextEncoder().encode(v);
export const hex=v=>Array.from(new Uint8Array(v),x=>x.toString(16).padStart(2,'0')).join('');
export function unhex(v){if(typeof v!=='string'||v.length%2||!/^[0-9a-f]+$/.test(v))throw Error('INVALID_HEX');return new Uint8Array(v.match(/../g).map(x=>parseInt(x,16)));}
export const nonce=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const hash=async v=>hex(await crypto.subtle.digest('SHA-256',bytes(canonical(v))));
export const hubMessage=c=>HUB_PRIVATE_VERSION+'\nONE_TIME_REQUEST\n'+canonical(c);
export const ownerMessage=b=>VAULT+'\nOWNER_COMMAND\n'+canonical(b);
export const accessMessage=b=>VAULT+'\nREADER_REQUEST\n'+canonical(b);
export const pairMessage=b=>PAIR+'\nPARTICIPANT_REQUEST\n'+canonical(b);
export const handoffMessage=b=>HANDOFF+'\nOWNER_DESTINATION_PERMISSION\n'+canonical(b);
export const noticeMessage=b=>NOTICE+'\nOWNER_DESTINATION_REVOCATION\n'+canonical(b);
const BACKUP='BAARNE_BROWSER_OWNER_BACKUP_V1';
async function passwordKey(password,salt){
  if(typeof password!=='string'||password.length<16||password.length>1024)throw Error('PASSPHRASE_AT_LEAST_16_CHARACTERS_REQUIRED');
  const raw=bytes(password);try{const material=await crypto.subtle.importKey('raw',raw,'PBKDF2',false,['deriveKey']);return await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}finally{raw.fill(0);}
}
async function provider(privateBytes,ownerKey,journalBytes,backup){
  const privateKey=await crypto.subtle.importKey('pkcs8',privateBytes,'Ed25519',false,['sign']);
  const journalKey=await crypto.subtle.importKey('raw',journalBytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
  let locked=false;
  return Object.freeze({ownerKey,backup:()=>structuredClone(backup),
    sign:async message=>{if(locked)throw Error('OWNER_LOCKED');return hex(await crypto.subtle.sign('Ed25519',privateKey,bytes(message)));},
    seal:async(value,context)=>{if(locked)throw Error('OWNER_LOCKED');const iv=crypto.getRandomValues(new Uint8Array(12));return {iv:hex(iv),data:hex(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes(context)},journalKey,bytes(canonical(value))))};},
    open:async(value,context)=>{if(locked)throw Error('OWNER_LOCKED');const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(value.iv),additionalData:bytes(context)},journalKey,unhex(value.data)));try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));}finally{raw.fill(0);}},
    lock:()=>{locked=true;}
  });
}
export async function createBrowserOwner(password){
  const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const privateBytes=new Uint8Array(await crypto.subtle.exportKey('pkcs8',keys.privateKey)),journal=crypto.getRandomValues(new Uint8Array(32));
  try{
    const ownerKey=hex(await crypto.subtle.exportKey('raw',keys.publicKey)),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await passwordKey(password,salt),header={version:BACKUP,ownerKey,salt:hex(salt),iv:hex(iv),iterations:310000};
    const raw=bytes(canonical({privateKey:hex(privateBytes),journalKey:hex(journal)}));
    try{const backup={header,data:hex(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes(canonical(header))},key,raw))};return await provider(privateBytes,ownerKey,journal,backup);}finally{raw.fill(0);}
  }finally{privateBytes.fill(0);journal.fill(0);}
}
export async function restoreBrowserOwner(backup,password){
  if(!backup||Object.keys(backup).sort().join(',')!=='data,header'||canonical(backup).length>8192)throw Error('INVALID_OWNER_BACKUP');
  const h=backup.header;if(!h||Object.keys(h).sort().join(',')!=='iterations,iv,ownerKey,salt,version'||h.version!==BACKUP||h.iterations!==310000||!/^[0-9a-f]{64}$/.test(h.ownerKey)||!/^[0-9a-f]{32}$/.test(h.salt)||!/^[0-9a-f]{24}$/.test(h.iv))throw Error('INVALID_OWNER_BACKUP');
  let raw,privateBytes,journal;try{
    const key=await passwordKey(password,unhex(h.salt));raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(h.iv),additionalData:bytes(canonical(h))},key,unhex(backup.data)));
    const value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));if(Object.keys(value).sort().join(',')!=='journalKey,privateKey')throw Error('INVALID_OWNER_BACKUP');
    privateBytes=unhex(value.privateKey);journal=unhex(value.journalKey);if(journal.length!==32)throw Error('INVALID_OWNER_BACKUP');
    const result=await provider(privateBytes,h.ownerKey,journal,backup),proof=await result.sign(BACKUP),publicKey=await crypto.subtle.importKey('raw',unhex(h.ownerKey),'Ed25519',false,['verify']);
    if(!await crypto.subtle.verify('Ed25519',publicKey,unhex(proof),bytes(BACKUP)))throw Error('OWNER_BACKUP_KEY_MISMATCH');return result;
  }finally{raw?.fill(0);privateBytes?.fill(0);journal?.fill(0);}
}
