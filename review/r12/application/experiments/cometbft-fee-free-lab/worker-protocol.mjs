import {canonical} from './application.mjs';

export const MAX_FRAME_BYTES=262208;
const MAX_REQUEST_BYTES=262144;

function exactKeys(value,keys){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}

function isCanonicalBase64(value){
  return typeof value==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)&&
    Buffer.from(value,'base64').toString('base64')===value;
}

function validateRequest(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||typeof request.method!=='string')throw Error('INVALID_WORKER_REQUEST');
  let valid=false;
  switch(request.method){
    case 'info': case 'commit': case 'query':
      valid=exactKeys(request,['method']);break;
    case 'init':
      valid=exactKeys(request,['method','chainId','genesis'])&&typeof request.chainId==='string'&&typeof request.genesis==='string';break;
    case 'check':
      valid=exactKeys(request,['method','tx'])&&isCanonicalBase64(request.tx);break;
    case 'finalize':
      valid=exactKeys(request,['method','height','time','txs'])&&Number.isSafeInteger(request.height)&&request.height>0&&
        Number.isSafeInteger(request.time)&&(request.txs===null||
          Array.isArray(request.txs)&&request.txs.length<=64&&request.txs.every(isCanonicalBase64));break;
    default: throw Error('UNKNOWN_METHOD');
  }
  if(!valid)throw Error('INVALID_WORKER_REQUEST');
}

export function parseWorkerFrame(line){
  if(typeof line!=='string'||Buffer.byteLength(line)>MAX_FRAME_BYTES)throw Error('IPC_FRAME_TOO_LARGE');
  let frame;
  try{frame=JSON.parse(line);}catch{throw Error('INVALID_IPC_FRAME');}
  if(!frame||typeof frame!=='object'||Array.isArray(frame)||Object.keys(frame).sort().join(',')!=='id,request'||!Number.isSafeInteger(frame.id)||frame.id<1||!Object.hasOwn(frame,'request'))throw Error('INVALID_IPC_FRAME');
  let normalized;
  try{normalized=canonical(frame);}catch{throw Error('INVALID_IPC_FRAME');}
  if(normalized!==line)throw Error('NONCANONICAL_IPC_FRAME');
  if(Buffer.byteLength(canonical(frame.request))>MAX_REQUEST_BYTES)throw Error('IPC_TOO_LARGE');
  validateRequest(frame.request);
  return frame;
}
