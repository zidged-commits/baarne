import {constants as fsConstants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';

export async function readBoundedRegularFile(path,maxBytes,fileError,sizeError){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw Error('INVALID_FILE_LIMIT');
  let pathInfo;
  try{pathInfo=await lstat(path);}catch{throw Error(fileError);}
  if(!pathInfo.isFile()||pathInfo.isSymbolicLink())throw Error(fileError);
  const flags=fsConstants.O_RDONLY|(fsConstants.O_NONBLOCK??0)|(fsConstants.O_NOFOLLOW??0);
  let handle;
  try{handle=await open(path,flags);}catch{throw Error(fileError);}
  try{
    const openedInfo=await handle.stat();
    if(!openedInfo.isFile()||openedInfo.dev!==pathInfo.dev||openedInfo.ino!==pathInfo.ino)throw Error(fileError);
    if(openedInfo.size>maxBytes)throw Error(sizeError);
    const buffer=Buffer.alloc(maxBytes+1);
    let offset=0;
    while(offset<buffer.length){
      const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);
      if(bytesRead===0)break;
      offset+=bytesRead;
    }
    if(offset>maxBytes)throw Error(sizeError);
    return buffer.subarray(0,offset);
  }finally{await handle.close();}
}
