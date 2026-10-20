// Local bounded-resource store, same V2 state commitment. No automatic pruning.
import {mkdir,open,opendir,lstat,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from './application.mjs';
import {createRecoverableExecution,applyRecoverableBlock,executionView} from './membership-recovery.mjs';
export const STORE_VERSION='BAARNE_SEGMENTED_MEMBERSHIP_STORE_LAB_V1';
const LIMITS=Object.freeze({maxBlocks:10000,maxHistoryBytes:64*1024*1024,maxStateBytes:4*1024*1024,maxRecordBytes:256*1024});
const filename=h=>'block-'+String(h).padStart(16,'0')+'.json';
async function bounded(path,max){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw Error('INVALID_FILE_OR_QUOTA');
  const handle=await open(path,'r');try{const bytes=Buffer.alloc(max+1);let n=0;
    while(n<bytes.length){const r=await handle.read(bytes,n,bytes.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}
    if(n>max)throw Error('INVALID_FILE_OR_QUOTA');return bytes.subarray(0,n).toString('utf8');
  }finally{await handle.close();}}
async function exclusiveAtomic(directory,name,raw,hook){
  const temporary=join(directory,'pending-'+randomUUID()+'.json'),handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
  try{
    await hook?.('beforePublish');
    await link(temporary,join(directory,name)); // Atomic publication; existing height is never overwritten.
    if(process.platform!=='win32'){const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}}
    await hook?.('afterPublish');
  }finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export class SegmentedMembershipApplication{
  #directory;#engine;#view;#head;#bytes;#limits;#pending;#busy=false;#hook;#faulted=false;
  constructor(directory,engine,head,bytes,limits,hook){this.#directory=directory;this.#engine=engine;this.#view=executionView(engine);
    this.#head=head;this.#bytes=bytes;this.#limits=limits;this.#hook=hook;}
  static async create(directory,input,options={}){
    const engine=createRecoverableExecution(input),limits={...LIMITS,...options.limits};
    SegmentedMembershipApplication.validateLimits(limits);
    if(Buffer.byteLength(canonical(executionView(engine).document))>limits.maxStateBytes)throw Error('STATE_QUOTA');
    const metadata={version:STORE_VERSION,genesisHash:digest(engine.config),limits};
    await mkdir(directory);await exclusiveAtomic(directory,'metadata.json',canonical(metadata));
    return new SegmentedMembershipApplication(directory,engine,digest(metadata),0,limits,options.hook);
  }
  static validateLimits(limits){if(Object.keys(limits).sort().join(',')!==Object.keys(LIMITS).sort().join(',')||
    Object.entries(limits).some(([k,v])=>!Number.isSafeInteger(v)||v<1||v>LIMITS[k]))throw Error('INVALID_LIMITS');}
  static async load(directory,input,options={}){
    const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('INVALID_DIRECTORY');
    const engine=createRecoverableExecution(input),raw=await bounded(join(directory,'metadata.json'),4096),metadata=JSON.parse(raw);
    if(canonical(metadata)!==raw||Object.keys(metadata).sort().join(',')!=='genesisHash,limits,version'||metadata.version!==STORE_VERSION||metadata.genesisHash!==digest(engine.config))throw Error('INVALID_METADATA');
    const limits=metadata.limits;SegmentedMembershipApplication.validateLimits(limits);
    if(Buffer.byteLength(canonical(executionView(engine).document))>limits.maxStateBytes)throw Error('STATE_QUOTA');
    // Enumerate incrementally and cap entry count before materializing sorted names.
    const names=[];for await(const entry of await opendir(directory,{bufferSize:32})){
      names.push(entry.name);if(names.length>limits.maxBlocks+34)throw Error('STORE_ENTRY_QUOTA');}
    const records=[],orphans=[];
    for(const name of names){if(name==='metadata.json')continue;
      if(name==='writer.lock'){const lock=await lstat(join(directory,name));if(!lock.isFile()||lock.isSymbolicLink()||lock.size!==0)throw Error('INVALID_WRITER_LOCK');continue;}
      if(/^block-[0-9]{16}\.json$/.test(name))records.push(name);
      else if(/^pending-[0-9a-f-]{36}\.json$/.test(name))orphans.push(name);
      else throw Error('UNEXPECTED_STORE_FILE');}
    if(records.length>limits.maxBlocks||orphans.length>32)throw Error('STORE_ENTRY_QUOTA');
    let head=digest(metadata),bytes=0;
    for(const name of records.sort()){
      if(name!==filename(engine.height+1))throw Error('MISSING_OR_REORDERED_BLOCK');
      const text=await bounded(join(directory,name),limits.maxRecordBytes),record=JSON.parse(text);
      if(canonical(record)!==text||Object.keys(record).sort().join(',')!=='block,previous,recordHash,stateHash')throw Error('INVALID_RECORD');
      const {recordHash,...body}=record;
      if(record.previous!==head||recordHash!==digest(body))throw Error('BROKEN_RECORD_CHAIN');
      await applyRecoverableBlock(engine,record.block);const view=executionView(engine);
      if(record.stateHash!==view.appHash||Buffer.byteLength(canonical(view.document))>limits.maxStateBytes)throw Error('STATE_HASH_OR_QUOTA');
      bytes+=Buffer.byteLength(text);if(bytes>limits.maxHistoryBytes)throw Error('HISTORY_QUOTA');head=recordHash;
    }
    // Unpublished crash remnants are never interpreted as committed blocks.
    // Keep them for diagnosis; no automatic deletion or repair of history.
    for(const name of orphans){const text=await bounded(join(directory,name),limits.maxRecordBytes);bytes+=Buffer.byteLength(text);}
    if(bytes>limits.maxHistoryBytes)throw Error('HISTORY_QUOTA');
    return new SegmentedMembershipApplication(directory,engine,head,bytes,limits,options.hook);
  }
  info(){if(this.#faulted)throw Error('REOPEN_REQUIRED');return {height:this.#engine.height,stateHash:this.#view.appHash,acceptedCount:this.#view.document.accepted.length};}
  capacity(){
    if(this.#faulted)throw Error('REOPEN_REQUIRED');
    const stagedBytes=this.#pending?Buffer.byteLength(this.#pending.raw):0;
    const stateBytes=Buffer.byteLength(canonical(this.#view.document));
    return {
      blocks:{used:this.#engine.height,limit:this.#limits.maxBlocks,remaining:this.#limits.maxBlocks-this.#engine.height},
      journalBytes:{stored:this.#bytes,staged:stagedBytes,limit:this.#limits.maxHistoryBytes,
        remaining:this.#limits.maxHistoryBytes-this.#bytes-stagedBytes},
      stateBytes:{used:stateBytes,limit:this.#limits.maxStateBytes,remaining:this.#limits.maxStateBytes-stateBytes},
      recordBytes:{limit:this.#limits.maxRecordBytes},
    };
  }
  exportState(){if(this.#faulted)throw Error('REOPEN_REQUIRED');return structuredClone(this.#view.document);}
  checkIntent(raw){
    if(this.#faulted)throw Error('REOPEN_REQUIRED');
    // Canonical signature admission does not promise stateful execution success.
    return this.#check(raw);
  }
  #check(raw){return checkRecoverableIntent(raw,this.#engine);}
  async stageBlock(height,time,txs){if(this.#faulted)throw Error('REOPEN_REQUIRED');if(this.#pending||this.#busy)throw Error('COMMIT_REQUIRED');this.#busy=true;
    try{
      if(height>this.#limits.maxBlocks)throw Error('BLOCK_QUOTA');
      const engine=structuredClone(this.#engine),block=structuredClone({height,time,txs});
      if(Buffer.byteLength(canonical(block))>this.#limits.maxRecordBytes-1024)throw Error('RECORD_QUOTA');
      const results=await applyRecoverableBlock(engine,block),view=executionView(engine);
      if(Buffer.byteLength(canonical(view.document))>this.#limits.maxStateBytes)throw Error('STATE_QUOTA');
      const body={block,previous:this.#head,stateHash:view.appHash},record={...body,recordHash:digest(body)},raw=canonical(record);
      if(Buffer.byteLength(raw)>this.#limits.maxRecordBytes||this.#bytes+Buffer.byteLength(raw)>this.#limits.maxHistoryBytes)throw Error('HISTORY_QUOTA');
      this.#pending={engine,view,record,raw};
      return {stateHash:view.appHash,results:results.map(r=>({code:['ACCEPTED','RECOVERED','DUPLICATE'].includes(r.status)?0:1,reason:r.status}))};
    }finally{this.#busy=false;}}
  async commit(){if(this.#faulted)throw Error('REOPEN_REQUIRED');if(!this.#pending||this.#busy)throw Error('FINALIZE_REQUIRED');this.#busy=true;const p=this.#pending;
    try{await exclusiveAtomic(this.#directory,filename(p.engine.height),p.raw,this.#hook);
      this.#engine=p.engine;this.#view=p.view;this.#head=p.record.recordHash;this.#bytes+=Buffer.byteLength(p.raw);this.#pending=null;return this.info();
    }catch(e){this.#faulted=true;throw e;}finally{this.#busy=false;}}
}
import {checkRecoverableIntent} from './membership-recovery.mjs';
