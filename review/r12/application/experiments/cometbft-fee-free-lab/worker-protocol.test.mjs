import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonical, digest, LabApplication} from './application.mjs';
import {MAX_FRAME_BYTES, parseWorkerFrame} from './worker-protocol.mjs';
import {readBoundedWorkerLines} from './worker-stdio.mjs';
import {MAX_GENESIS_FILE_BYTES, loadWorkerGenesis} from './worker-config.mjs';

test('worker genesis loader accepts only bounded regular strict-canonical JSON files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-worker-genesis-'));
  const genesis={domain:'BAARNE_FEE_FREE_APPLICATION_LAB_V1',slots:{'lab-slot-a':'a'.repeat(64)}};
  try{
    const valid=join(root,'valid.json');
    await writeFile(valid,canonical(genesis));
    assert.deepEqual(await loadWorkerGenesis(valid),genesis);

    const duplicate=join(root,'duplicate.json');
    await writeFile(duplicate,'{"domain":"BAARNE_FEE_FREE_APPLICATION_LAB_V1","slots":{},"slots":{"lab-slot-a":"'+('a'.repeat(64))+'"}}');
    await assert.rejects(loadWorkerGenesis(duplicate),{message:'NONCANONICAL_GENESIS'});

    const whitespace=join(root,'whitespace.json');
    await writeFile(whitespace,canonical(genesis)+'\n');
    await assert.rejects(loadWorkerGenesis(whitespace),{message:'NONCANONICAL_GENESIS'});

    const malformedUtf8=join(root,'invalid-utf8.json');
    await writeFile(malformedUtf8,Buffer.from([0xff,0xfe]));
    await assert.rejects(loadWorkerGenesis(malformedUtf8),{message:'INVALID_GENESIS_JSON'});

    const oversized=join(root,'oversized.json');
    await writeFile(oversized,Buffer.alloc(MAX_GENESIS_FILE_BYTES+1,0x20));
    await assert.rejects(loadWorkerGenesis(oversized),{message:'GENESIS_FILE_TOO_LARGE'});

    await assert.rejects(loadWorkerGenesis(root),{message:'INVALID_GENESIS_FILE'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('worker request frame accepts the canonical Go bridge envelope',()=>{
  const frame={id:7,request:{method:'finalize',height:1,time:1010,txs:['e30=']}};
  assert.deepEqual(parseWorkerFrame(canonical(frame)),frame);
  // encoding/json emits a nil [][]byte as null for ordinary empty blocks.
  for(const txs of [null,[]]){
    const empty={id:8,request:{method:'finalize',height:2,time:1011,txs}};
    assert.deepEqual(parseWorkerFrame(canonical(empty)),empty);
  }
});

test('worker request frame rejects duplicate and escaped duplicate keys at every depth',()=>{
  const invalid=[
    '{"id":1,"request":{"method":"info"},"id":2}',
    '{"id":1,"i\\u0064":2,"request":{"method":"info"}}',
    '{"id":1,"request":{"method":"info","method":"commit"}}',
    '{"id":1,"request":{"method":"query","nested":{"x":1,"x":2}}}'
  ];
  for(const line of invalid)assert.throws(()=>parseWorkerFrame(line),/NONCANONICAL_IPC_FRAME|INVALID_IPC_FRAME/);
});

test('worker request frame rejects noncanonical and incomplete JSONL records',()=>{
  for(const line of [' {"id":1,"request":{"method":"info"}}','{"id":1,"request":{"method":"info"}}\n','{"id":1,"request":{"method":"info"}} {}','{"id":0,"request":{}}','{"id":1}'])assert.throws(()=>parseWorkerFrame(line));
});

test('worker request frame rejects unknown methods, extra keys, and invalid method fields',()=>{
  const invalid=[
    {method:'restart'},
    {method:'info',force:true},
    {method:'init',chainId:'lab'},
    {method:'check',tx:12},
    {method:'finalize',height:1,time:1,txs:['e30='],unsafe:true},
    {method:'finalize',height:1.5,time:1,txs:[]},
    {method:'finalize',height:1,time:1,txs:[null]}
  ];
  for(const request of invalid)assert.throws(()=>parseWorkerFrame(canonical({id:1,request})));
});

test('worker request frame rejects permissive, malformed, and noncanonical base64 byte fields',()=>{
  const invalid=[
    {method:'check',tx:'!!!!'},
    {method:'check',tx:'Zg'},
    {method:'check',tx:'Zh=='},
    {method:'finalize',height:1,time:1,txs:['e30=','Y Q==']}
  ];
  for(const request of invalid)assert.throws(()=>parseWorkerFrame(canonical({id:1,request})));
  for(const request of [{method:'check',tx:''},{method:'finalize',height:1,time:1,txs:['e30=','']}])
    assert.deepEqual(parseWorkerFrame(canonical({id:1,request})).request,request);
});

test('worker request and frame byte limits accept their boundary and reject the next byte',()=>{
  const maxRequest={id:1,request:{method:'check',tx:'A'.repeat(262116)}};
  assert.equal(Buffer.byteLength(canonical(maxRequest.request)),262142);
  assert.deepEqual(parseWorkerFrame(canonical(maxRequest)),maxRequest);

  const oversizedRequest={id:1,request:{method:'check',tx:'A'.repeat(262120)}};
  assert.equal(Buffer.byteLength(canonical(oversizedRequest.request)),262146);
  assert.ok(Buffer.byteLength(canonical(oversizedRequest))<262208);
  assert.throws(()=>parseWorkerFrame(canonical(oversizedRequest)),{message:'IPC_TOO_LARGE'});

  const exactFrameLimit={id:1,request:{method:'check',tx:'A'.repeat(262163)}};
  assert.equal(Buffer.byteLength(canonical(exactFrameLimit)),262208);
  assert.throws(()=>parseWorkerFrame(canonical(exactFrameLimit)),{message:'IPC_TOO_LARGE'});

  const oversizedFrame={id:1,request:{method:'check',tx:'A'.repeat(262164)}};
  assert.equal(Buffer.byteLength(canonical(oversizedFrame)),262209);
  assert.throws(()=>parseWorkerFrame(canonical(oversizedFrame)),{message:'IPC_FRAME_TOO_LARGE'});
});

test('worker stdin reader frames split and coalesced chunks with a strict byte bound',async()=>{
  const split=(async function*(){yield Buffer.from('first');yield Buffer.from(' line\nsecond');yield Buffer.from(' line\n');})();
  const lines=[];
  for await(const line of readBoundedWorkerLines(split))lines.push(line.toString('utf8'));
  assert.deepEqual(lines,['first line','second line']);

  const exact=(async function*(){yield Buffer.alloc(MAX_FRAME_BYTES,0x78);yield Buffer.from('\n');})();
  const exactLines=[];
  for await(const line of readBoundedWorkerLines(exact))exactLines.push(line);
  assert.equal(exactLines.length,1);
  assert.equal(exactLines[0].length,MAX_FRAME_BYTES);

  let chunksRead=0;
  const oversized=(async function*(){
    chunksRead++;yield Buffer.alloc(MAX_FRAME_BYTES,0x78);
    chunksRead++;yield Buffer.from('x');
    chunksRead++;yield Buffer.from('\n');
  })();
  const iterator=readBoundedWorkerLines(oversized)[Symbol.asyncIterator]();
  await assert.rejects(iterator.next(),{message:'IPC_FRAME_TOO_LARGE'});
  assert.equal(chunksRead,2,'reader rejects immediately after the first byte over the limit');
  await iterator.return();
});

test('bounded JSONL reader supports a larger explicit offline replay cap and rejects the first excess byte',async()=>{
  let chunksRead=0;
  const input=(async function*(){
    chunksRead++;yield Buffer.alloc(32,0x78);
    chunksRead++;yield Buffer.from('x');
    chunksRead++;yield Buffer.from('\n');
  })();
  const iterator=readBoundedWorkerLines(input,{maxBytes:32,errorCode:'OBSERVER_INPUT_TOO_LARGE'})[Symbol.asyncIterator]();
  await assert.rejects(iterator.next(),{message:'OBSERVER_INPUT_TOO_LARGE'});
  assert.equal(chunksRead,2,'bounded reader stops as soon as input exceeds the observer cap');
  await iterator.return();
});

test('observer process rejects stdin beyond the offline replay packet cap',async()=>{
  const observer=fileURLToPath(new URL('./observer.mjs',import.meta.url));
  const names=Array.from({length:4},(_,i)=>`baarne-abci-012345abcdef-node${i}`);
  const child=spawn(process.execPath,[observer,JSON.stringify(names)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='';
  child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
  child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
  const closed=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',(code,signal)=>resolve({code,signal}));
  });
  child.stdin.end(Buffer.alloc(16*1024*1024+1,0x78));
  const result=await closed;
  assert.notEqual(result.code,0);
  assert.match(stderr,/OBSERVER_INPUT_TOO_LARGE/);
  assert.equal(stdout,'','oversized records are rejected before JSON parsing or a success response');
});

test('observer rejects unsafe RPC methods before issuing a node request',async()=>{
  const observer=fileURLToPath(new URL('./observer.mjs',import.meta.url));
  const names=Array.from({length:4},(_,i)=>`baarne-abci-012345abcdef-node${i}`);
  const child=spawn(process.execPath,[observer,JSON.stringify(names)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='';
  child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
  child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
  const closed=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',(code,signal)=>resolve({code,signal}));
  });
  child.stdin.end('{"node":0,"method":"dial_peers","params":{"peers":["example.invalid"]}}\n');
  const result=await closed;
  assert.equal(result.code,0,stderr);
  assert.equal(result.signal,null);
  assert.deepEqual(JSON.parse(stdout),{ok:false,error:'INVALID_OBSERVER_RPC_REQUEST'});
});

test('observer rejects duplicate and escaped-equivalent JSONL request keys before dispatch',async()=>{
  const observer=fileURLToPath(new URL('./observer.mjs',import.meta.url));
  const names=Array.from({length:4},(_,i)=>`baarne-abci-012345abcdef-node${i}`);
  const child=spawn(process.execPath,[observer,JSON.stringify(names)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='';
  child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
  child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
  const closed=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',(code,signal)=>resolve({code,signal}));
  });
  child.stdin.end([
    '{"node":0,"node":1,"method":"status"}',
    '{"node":0,"n\\u006fde":1,"method":"status"}',
    '{"node":0,"method":"status","params":{"nested":{"x":1,"x":2}}}',
  ].join('\n')+'\n');
  const result=await closed;
  assert.equal(result.code,0,stderr);
  assert.equal(result.signal,null);
  assert.deepEqual(stdout.trimEnd().split('\n').map(line=>JSON.parse(line)),[
    {ok:false,error:'INVALID_OBSERVER_RPC_JSON'},
    {ok:false,error:'INVALID_OBSERVER_RPC_JSON'},
    {ok:false,error:'INVALID_OBSERVER_RPC_JSON'},
  ]);
});

test('observer rejects JSON-RPC responses with a mismatched correlation id',async()=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-observer-rpc-id-'));
  const observer=fileURLToPath(new URL('./observer.mjs',import.meta.url));
  const mockFetch=join(root,'mock-fetch.mjs');
  const names=Array.from({length:4},(_,i)=>`baarne-abci-012345abcdef-node${i}`);
  try{
    await writeFile(mockFetch,"globalThis.fetch=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:99,result:{syncing:false}}),{status:200,headers:{'content-type':'application/json'}});\n");
    const child=spawn(process.execPath,['--import',pathToFileURL(mockFetch).href,observer,JSON.stringify(names)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
    child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
    const closed=new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
    child.stdin.end('{"node":0,"method":"status","params":{}}\n');
    const result=await closed;
    assert.equal(result.code,0,stderr);
    assert.equal(result.signal,null);
    assert.deepEqual(JSON.parse(stdout),{ok:false,error:'INVALID_OBSERVER_RPC_RESPONSE'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('observer rejects a JSON body served with a non-JSON content type',async()=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-observer-rpc-content-type-'));
  const observer=fileURLToPath(new URL('./observer.mjs',import.meta.url));
  const mockFetch=join(root,'mock-fetch.mjs');
  const names=Array.from({length:4},(_,i)=>`baarne-abci-012345abcdef-node${i}`);
  try{
    await writeFile(mockFetch,"globalThis.fetch=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{syncing:false}}),{status:200,headers:{'content-type':'text/plain'}});\n");
    const child=spawn(process.execPath,['--import',pathToFileURL(mockFetch).href,observer,JSON.stringify(names)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
    child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
    const closed=new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
    child.stdin.end('{"node":0,"method":"status","params":{}}\n');
    const result=await closed;
    assert.equal(result.code,0,stderr);
    assert.equal(result.signal,null);
    assert.deepEqual(JSON.parse(stdout),{ok:false,error:'INVALID_OBSERVER_RPC_CONTENT_TYPE'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('worker process accepts a Go-compatible JSONL request and returns info',async()=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-worker-frame-'));
  const store=join(root,'state');
  const genesis={domain:'BAARNE_FEE_FREE_APPLICATION_LAB_V1',slots:{'lab-slot-a':'a'.repeat(64)}};
  try {
    await LabApplication.create(store,genesis);
    const genesisFile=join(root,'genesis.json');
    await writeFile(genesisFile,JSON.stringify(genesis));
    const worker=fileURLToPath(new URL('./worker.mjs',import.meta.url));
    const child=spawn(process.execPath,[worker,store,genesisFile],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
    child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
    const closed=new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
    child.stdin.end('{"id":1,"request":{"method":"info"}}\n');
    const exit=await closed;
    assert.equal(exit.code,0,stderr);
    assert.equal(exit.signal,null);
    const state=JSON.parse(await readFile(join(store,'state.json'),'utf8')).state;
    assert.deepEqual(JSON.parse(stdout),{id:1,response:{ok:true,result:{height:0,stateHash:digest(state),acceptedCount:0}}});
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test('worker process fails closed on a duplicate-key frame without changing persisted state',async()=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-worker-invalid-frame-'));
  const store=join(root,'state');
  const genesis={domain:'BAARNE_FEE_FREE_APPLICATION_LAB_V1',slots:{'lab-slot-a':'a'.repeat(64)}};
  try {
    await LabApplication.create(store,genesis);
    const genesisFile=join(root,'genesis.json');
    await writeFile(genesisFile,JSON.stringify(genesis));
    const statePath=join(store,'state.json');
    const before=await readFile(statePath);
    const worker=fileURLToPath(new URL('./worker.mjs',import.meta.url));
    const child=spawn(process.execPath,[worker,store,genesisFile],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
    child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
    const closed=new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
    child.stdin.end('{"id":1,"request":{"method":"info"},"request":{"method":"commit"}}\n');
    const exit=await closed;
    assert.equal(exit.code,1);
    assert.equal(exit.signal,null);
    assert.equal(stdout,'');
    assert.match(stderr,/NONCANONICAL_IPC_FRAME/);
    assert.deepEqual(await readFile(statePath),before);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test('worker process rejects an oversized unterminated stdin frame without changing state',async()=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-worker-oversized-stdin-'));
  const store=join(root,'state');
  const genesis={domain:'BAARNE_FEE_FREE_APPLICATION_LAB_V1',slots:{'lab-slot-a':'a'.repeat(64)}};
  try {
    await LabApplication.create(store,genesis);
    const genesisFile=join(root,'genesis.json');
    await writeFile(genesisFile,JSON.stringify(genesis));
    const statePath=join(store,'state.json');
    const before=await readFile(statePath);
    const worker=fileURLToPath(new URL('./worker.mjs',import.meta.url));
    const child=spawn(process.execPath,[worker,store,genesisFile],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
    child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
    const closed=new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
    child.stdin.end(Buffer.alloc(MAX_FRAME_BYTES+1,0x78));
    const exit=await closed;
    assert.equal(exit.code,1);
    assert.equal(exit.signal,null);
    assert.equal(stdout,'');
    assert.match(stderr,/IPC_FRAME_TOO_LARGE/);
    assert.deepEqual(await readFile(statePath),before);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test('worker process accepts Go-shaped finalize and commit frames and persists the next height',async()=>{
  const root=await mkdtemp(join(tmpdir(),'baarne-worker-finalize-frame-'));
  const store=join(root,'state');
  const genesis={domain:'BAARNE_FEE_FREE_APPLICATION_LAB_V1',slots:{'lab-slot-a':'a'.repeat(64)}};
  try {
    await LabApplication.create(store,genesis);
    const genesisFile=join(root,'genesis.json');
    await writeFile(genesisFile,JSON.stringify(genesis));
    const worker=fileURLToPath(new URL('./worker.mjs',import.meta.url));
    const child=spawn(process.execPath,[worker,store,genesisFile],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
    child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
    const closed=new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
    child.stdin.end('{"id":1,"request":{"height":1,"method":"finalize","time":1010,"txs":[]}}\n{"id":2,"request":{"method":"commit"}}\n');
    const exit=await closed;
    assert.equal(exit.code,0,stderr);
    assert.equal(exit.signal,null);
    const replies=stdout.trimEnd().split('\n').map(line=>JSON.parse(line));
    assert.equal(replies.length,2);
    assert.equal(replies[0].id,1);
    assert.equal(replies[0].response.ok,true);
    assert.deepEqual(replies[0].response.result.results,[]);
    assert.equal(replies[1].id,2);
    assert.equal(replies[1].response.ok,true);
    const state=JSON.parse(await readFile(join(store,'state.json'),'utf8')).state;
    assert.equal(state.height,1);
    assert.equal(replies[1].response.result.height,1);
    assert.equal(replies[1].response.result.stateHash,digest(state));
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
