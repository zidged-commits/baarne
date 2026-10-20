import {readBoundedRegularFile} from './bounded-input.mjs';
import {lstat} from 'node:fs/promises';
import {canonical} from './application.mjs';

export const MEMBERSHIP_LAB_BLOCK_LIMIT=128;
export const MEMBERSHIP_LAB_BLOCK_BYTES_LIMIT=131072;
export const MEMBERSHIP_LAB_STORE_BYTES_LIMIT=MEMBERSHIP_LAB_BLOCK_LIMIT*MEMBERSHIP_LAB_BLOCK_BYTES_LIMIT+65536;

export function validateMembershipLabBlockBytes(block){
  if(Buffer.byteLength(canonical(block))>MEMBERSHIP_LAB_BLOCK_BYTES_LIMIT)throw Error('BLOCK_TOO_LARGE');
}

export async function readMembershipLabStore(path){
  try{await lstat(path);}catch(error){if(error.code==='ENOENT')throw error;throw Error('INVALID_STORE_FILE');}
  const bytes=await readBoundedRegularFile(path,MEMBERSHIP_LAB_STORE_BYTES_LIMIT,'INVALID_STORE_FILE','STORE_TOO_LARGE');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('INVALID_STORE_ENCODING');}
}
