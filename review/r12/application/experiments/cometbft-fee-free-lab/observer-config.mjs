const NODE_NAME=/^(baarne-comet|baarne-abci|baarne-v3)-([a-f0-9]{12})-node([0-3])$/;
const READ_OR_SYNC_METHODS=new Set(['status','block','block_results','abci_query','tx','broadcast_tx_sync']);

export function parseObserverNodeNames(raw){
  let names;
  try{names=JSON.parse(raw);}catch{throw Error('INVALID_OBSERVER_NODE_NAMES');}
  if(!Array.isArray(names)||names.length!==4)throw Error('INVALID_OBSERVER_NODE_NAMES');
  const parsed=names.map(name=>typeof name==='string'?NODE_NAME.exec(name):null);
  if(parsed.some(match=>!match))throw Error('INVALID_OBSERVER_NODE_NAMES');
  const [,prefix,session]=parsed[0];
  if(parsed.some(([,p,s],index)=>p!==prefix||s!==session||Number(parsed[index][3])!==index))
    throw Error('INVALID_OBSERVER_NODE_NAMES');
  return [...names];
}

export function validateObserverRpcRequest(request){
  if(!request||typeof request!=='object'||Array.isArray(request))throw Error('INVALID_OBSERVER_RPC_REQUEST');
  const keys=Object.keys(request).sort();
  if(keys.some(key=>!['method','node','operation','params'].includes(key))||
    !Number.isInteger(request.node)||request.node<0||request.node>3||typeof request.method!=='string')
    throw Error('INVALID_OBSERVER_RPC_REQUEST');
  const operation=request.operation??'rpc';
  if(operation!=='rpc'&&operation!=='discardResponse')throw Error('INVALID_OBSERVER_RPC_REQUEST');
  if(operation==='discardResponse'){
    if(request.method!=='broadcast_tx_commit')throw Error('INVALID_OBSERVER_RPC_REQUEST');
  }else if(!READ_OR_SYNC_METHODS.has(request.method))throw Error('INVALID_OBSERVER_RPC_REQUEST');
  if(request.params!==undefined&&(!request.params||typeof request.params!=='object'||Array.isArray(request.params)))
    throw Error('INVALID_OBSERVER_RPC_REQUEST');
  return request;
}

export function validateObserverRpcResponse(response,expectedId=1){
  if(!response||typeof response!=='object'||Array.isArray(response))throw Error('INVALID_OBSERVER_RPC_RESPONSE');
  const keys=Object.keys(response).sort();
  if(keys.some(key=>!['jsonrpc','id','result','error'].includes(key))||
    response.jsonrpc!=='2.0'||response.id!==expectedId)
    throw Error('INVALID_OBSERVER_RPC_RESPONSE');
  const hasResult=Object.hasOwn(response,'result'),hasError=Object.hasOwn(response,'error');
  if(hasResult===hasError)throw Error('INVALID_OBSERVER_RPC_RESPONSE');
  if(hasError){
    const error=response.error;
    if(!error||typeof error!=='object'||Array.isArray(error)||
      Object.keys(error).some(key=>!['code','message','data'].includes(key))||
      !Number.isInteger(error.code)||typeof error.message!=='string')
      throw Error('INVALID_OBSERVER_RPC_RESPONSE');
  }
  return response;
}
