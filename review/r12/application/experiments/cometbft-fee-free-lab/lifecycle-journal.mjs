// Bounded local journal; external trusted head pin is required on reopen.
// Hash pins are not consensus certificates or independent operator authority.
import {mkdir,open,link,unlink,lstat,readFile,opendir} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {randomUUID} from 'node:crypto';import {join} from 'node:path';
import {canonical,digest} from './application.mjs';
import {createLifecycle,applyLifecycleBlock,lifecycleView,exact,LIFECYCLE_V3} from './lifecycle-v3.mjs';
const VERSION='BAARNE_SYNTHETIC_LIFECYCLE_JOURNAL_V1';
const MAX_PENDING_ARTIFACTS=64;
const MAX_BLOCK_BYTES=270000;
const filename=h=>'block-'+String(h).padStart(4,'0')+'.json';
const isPendingArtifact=name=>/^pending-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(name);
function assertSyntheticScope(config){if(!config||config.domain!==LIFECYCLE_V3||config.mode!=='ISOLATED_SYNTHETIC_LAB')throw Error('SYNTHETIC_CONTEXT_REQUIRED');}
async function assertJournalDirectory(directory){const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('INVALID_STORE_DIRECTORY');}
async function boundedRead(path,max){
  const pathInfo=await lstat(path);if(!pathInfo.isFile())throw Error('INVALID_FILE');
  const flags=fsConstants.O_RDONLY|(fsConstants.O_NONBLOCK??0)|(fsConstants.O_NOFOLLOW??0);let file;
  try{file=await open(path,flags);}catch(error){if(error.code==='ELOOP')throw Error('INVALID_FILE');throw error;}
  try{
    const openedInfo=await file.stat();if(!openedInfo.isFile()||openedInfo.dev!==pathInfo.dev||openedInfo.ino!==pathInfo.ino)throw Error('INVALID_FILE');
    if(openedInfo.size>max)throw Error('INVALID_FILE');
    const buffer=Buffer.alloc(max+1);let offset=0;
    while(offset<buffer.length){const {bytesRead}=await file.read(buffer,offset,buffer.length-offset,offset);if(bytesRead===0)break;offset+=bytesRead;}
    if(offset>max)throw Error('INVALID_FILE');
    const raw=buffer.toString('utf8',0,offset),document=JSON.parse(raw);
    if(canonical(document)!==raw)throw Error('NONCANONICAL_STORE');return document;
  }finally{await file.close();}
}
async function publish(directory,name,document){
  const temporary=join(directory,'pending-'+randomUUID()),file=await open(temporary,'wx',0o600);
  try{await file.writeFile(canonical(document),'utf8');await file.sync();}finally{await file.close();}
  try{await link(temporary,join(directory,name));}finally{await unlink(temporary);}
  if(process.platform!=='win32'){const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}}
  // Windows has no portable directory fsync. File publication is exclusive;
  // this prototype does not certify power-loss persistence on Windows.
}
export class LifecycleJournal{
  #directory;#engine;#pin;#busy=false;#faulted=false;
  constructor(directory,engine,pin){this.#directory=directory;this.#engine=engine;this.#pin=pin;}
  static async create(directory,config,bootstrap){assertSyntheticScope(config);const engine=await createLifecycle(config,bootstrap),meta={version:VERSION,config,bootstrap};await mkdir(directory,{mode:0o700});await publish(directory,'metadata.json',meta);return new LifecycleJournal(directory,engine,digest(meta));}
  static async load(directory,config,bootstrap,trusted){
    assertSyntheticScope(config);
    exact(trusted,['height','head','appHash']);if(!Number.isSafeInteger(trusted.height)||trusted.height<0||trusted.height>1000)throw Error('INVALID_PIN');
    await assertJournalDirectory(directory);
    const meta=await boundedRead(join(directory,'metadata.json'),65536);if(canonical(meta)!==canonical({version:VERSION,config,bootstrap}))throw Error('WRONG_JOURNAL_SCOPE');
    const entries=await opendir(directory);let count=0,pending=0;for await(const entry of entries){if(entry.name==='writer.lock'&&entry.isFile()&&(await lstat(join(directory,entry.name))).size===0)continue;if(isPendingArtifact(entry.name)){const info=await lstat(join(directory,entry.name));if(!entry.isFile()||info.isSymbolicLink()||info.size>MAX_BLOCK_BYTES||++pending>MAX_PENDING_ARTIFACTS)throw Error('JOURNAL_QUOTA');continue;}count++;if(count>1001||!entry.isFile()||!(entry.name==='metadata.json'||/^block-[0-9]{4}\.json$/.test(entry.name)))throw Error('UNEXPECTED_STORE_ENTRY');}
    if(count!==trusted.height+1)throw Error('HISTORY_LENGTH_MISMATCH');
    const engine=await createLifecycle(config,bootstrap);let head=digest(meta);
    for(let h=1;h<=trusted.height;h++){const row=await boundedRead(join(directory,filename(h)),MAX_BLOCK_BYTES);exact(row,['previous','block','appHash']);if(row.previous!==head||row.block.height!==h)throw Error('BROKEN_HISTORY');await applyLifecycleBlock(engine,row.block);if(lifecycleView(engine).appHash!==row.appHash)throw Error('INVALID_STATE_COMMITMENT');head=digest(row);}
    if(head!==trusted.head||lifecycleView(engine).appHash!==trusted.appHash)throw Error('UNTRUSTED_HISTORY');return new LifecycleJournal(directory,engine,head);
  }
  static async loadForConsensus(directory,config,bootstrap){
    assertSyntheticScope(config);
    // Locally derived head is only an integrity check. CometBFT handshake,
    // its block store and authenticated history supply consensus authority.
    await assertJournalDirectory(directory);
    const entries=await opendir(directory);let height=0,count=0;
    for await(const entry of entries){if(++count>1002+MAX_PENDING_ARTIFACTS)throw Error('JOURNAL_QUOTA');if(/^block-[0-9]{4}\.json$/.test(entry.name))height=Math.max(height,Number(entry.name.slice(6,10)));}
    const meta=await boundedRead(join(directory,'metadata.json'),65536);
    const row=height?await boundedRead(join(directory,filename(height)),270000):null;
    const initial=await createLifecycle(config,bootstrap);
    return LifecycleJournal.load(directory,config,bootstrap,{height,head:digest(row??meta),appHash:row?.appHash??lifecycleView(initial).appHash});
  }
  view(){return lifecycleView(this.#engine);}
  pin(){return {height:this.#engine.height,head:this.#pin,appHash:lifecycleView(this.#engine).appHash};}
  async append(block){
    if(this.#busy||this.#faulted)throw Error('BUSY_OR_REOPEN_REQUIRED');this.#busy=true;
    try{const next=structuredClone(this.#engine),results=await applyLifecycleBlock(next,block),row={previous:this.#pin,block:structuredClone(block),appHash:lifecycleView(next).appHash};
      await publish(this.#directory,filename(next.height),row);this.#engine=next;this.#pin=digest(row);return {results,pin:this.pin()};
    }catch(e){this.#faulted=true;throw e;}finally{this.#busy=false;}
  }
}
