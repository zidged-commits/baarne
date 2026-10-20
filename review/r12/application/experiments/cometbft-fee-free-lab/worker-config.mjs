import {readBoundedRegularFile} from './bounded-input.mjs';
import {canonical} from './application.mjs';

export const MAX_GENESIS_FILE_BYTES=65536;
export const MAX_ENROLLMENT_FILE_BYTES=128*1024;

async function loadCanonicalJsonFile(path,{maxBytes,fileError,sizeError,jsonError,canonicalError}){
  const bytes=await readBoundedRegularFile(path,maxBytes,fileError,sizeError);
  let raw,genesis;
  try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);genesis=JSON.parse(raw);}catch{throw Error(jsonError);}
  let normalized;
  try{normalized=canonical(genesis);}catch{throw Error(jsonError);}
  if(normalized!==raw)throw Error(canonicalError);
  return genesis;
}

export async function loadWorkerGenesis(path){
  return loadCanonicalJsonFile(path,{maxBytes:MAX_GENESIS_FILE_BYTES,fileError:'INVALID_GENESIS_FILE',
    sizeError:'GENESIS_FILE_TOO_LARGE',jsonError:'INVALID_GENESIS_JSON',canonicalError:'NONCANONICAL_GENESIS'});
}

export async function loadWorkerEnrollment(path){
  return loadCanonicalJsonFile(path,{maxBytes:MAX_ENROLLMENT_FILE_BYTES,fileError:'INVALID_ENROLLMENT_FILE',
    sizeError:'ENROLLMENT_FILE_TOO_LARGE',jsonError:'INVALID_ENROLLMENT_JSON',canonicalError:'NONCANONICAL_ENROLLMENT'});
}
