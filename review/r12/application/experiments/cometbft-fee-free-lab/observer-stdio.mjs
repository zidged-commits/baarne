import {once} from 'node:events';

export const MAX_OBSERVER_RECORD_BYTES=16*1024*1024;
const OVERSIZED_RESPONSE=JSON.stringify({ok:false,error:'OBSERVER_RESPONSE_TOO_LARGE'});

function parseUniqueJson(raw){
  let offset=0;
  const isWhitespace=char=>char==='\u0009'||char==='\u000a'||char==='\u000d'||char==='\u0020';
  const whitespace=()=>{while(isWhitespace(raw[offset]))offset++;};
  const string=()=>{
    const start=offset++;
    while(offset<raw.length){
      const char=raw[offset++];
      if(char==='"')return JSON.parse(raw.slice(start,offset));
      if(char==='\\'){if(offset>=raw.length)throw Error();offset++;}
      else if(char<' ')throw Error();
    }
    throw Error();
  };
  const value=depth=>{
    if(depth>256)throw Error();
    whitespace();
    const char=raw[offset];
    if(char==='"')return string();
    if(char==='{'){
      offset++;whitespace();const object={};
      if(raw[offset]==='}'){offset++;return object;}
      const seen=new Set();
      while(true){
        whitespace();if(raw[offset]!=='"')throw Error();
        const key=string();if(seen.has(key))throw Error();seen.add(key);
        whitespace();if(raw[offset++]!==':')throw Error();
        const item=value(depth+1);
        Object.defineProperty(object,key,{value:item,enumerable:true,configurable:true,writable:true});
        whitespace();const delimiter=raw[offset++];
        if(delimiter==='}')return object;
        if(delimiter!==',')throw Error();
      }
    }
    if(char==='['){
      offset++;whitespace();const array=[];
      if(raw[offset]===']'){offset++;return array;}
      while(true){
        array.push(value(depth+1));whitespace();const delimiter=raw[offset++];
        if(delimiter===']')return array;
        if(delimiter!==',')throw Error();
      }
    }
    for(const [literal,result] of [['true',true],['false',false],['null',null]]){
      if(raw.startsWith(literal,offset)){offset+=literal.length;return result;}
    }
    const match=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(offset));
    if(match){offset+=match[0].length;return Number(match[0]);}
    throw Error();
  };
  const parsed=value(0);whitespace();if(offset!==raw.length)throw Error();return parsed;
}

export function parseUniqueObserverJson(raw){
  try{
    if(typeof raw!=='string')throw Error();
    return parseUniqueJson(raw);
  }catch{throw Error('INVALID_OBSERVER_RPC_JSON');}
}

export async function writeBoundedObserverResponse(response,output=process.stdout,maxBytes=MAX_OBSERVER_RECORD_BYTES){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<Buffer.byteLength(OVERSIZED_RESPONSE))throw Error('INVALID_OBSERVER_RESPONSE_BOUND');
  let line=JSON.stringify(response);
  if(Buffer.byteLength(line)>maxBytes)line=OVERSIZED_RESPONSE;
  if(!output.write(`${line}\n`))await once(output,'drain');
}

export async function readBoundedObserverJson(response,maxBytes=MAX_OBSERVER_RECORD_BYTES){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('INVALID_OBSERVER_RESPONSE_BOUND');
  const declared=response.headers?.get('content-length');
  if(declared&&/^\d+$/.test(declared)&&Number(declared)>maxBytes){
    try{await response.body?.cancel();}catch{}
    throw Error('OBSERVER_RPC_RESPONSE_TOO_LARGE');
  }
  if(!response.body)throw Error('OBSERVER_RPC_RESPONSE_EMPTY');
  const reader=response.body.getReader(),chunks=[];
  let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes){
        try{await reader.cancel();}catch{}
        throw Error('OBSERVER_RPC_RESPONSE_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  }finally{reader.releaseLock();}
  try{return parseUniqueObserverJson(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
  catch{throw Error('INVALID_OBSERVER_RPC_JSON');}
}

export function requireObserverJsonContentType(headers){
  const value=headers?.get?.('content-type');
  if(typeof value!=='string'||!/^\s*application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8")\s*)?$/i.test(value))
    throw Error('INVALID_OBSERVER_RPC_CONTENT_TYPE');
}
