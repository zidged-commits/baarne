import {MAX_FRAME_BYTES} from './worker-protocol.mjs';

// Accumulate at most one bounded JSONL record. Copy accepted slices so a small
// record cannot retain a much larger upstream Buffer allocation.
export async function* readBoundedWorkerLines(stream,{maxBytes=MAX_FRAME_BYTES,errorCode='IPC_FRAME_TOO_LARGE'}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||typeof errorCode!=='string'||errorCode.length===0)throw Error('INVALID_LINE_BOUND');
  let parts=[],size=0;
  for await(const value of stream){
    const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);
    let start=0;
    while(start<chunk.length){
      const newline=chunk.indexOf(0x0a,start);
      const end=newline<0?chunk.length:newline;
      const length=end-start;
      if(size+length>maxBytes)throw Error(errorCode);
      if(length){parts.push(Buffer.from(chunk.subarray(start,end)));size+=length;}
      if(newline<0)break;
      yield Buffer.concat(parts,size);
      parts=[];size=0;start=newline+1;
    }
  }
  if(size)yield Buffer.concat(parts,size);
}
