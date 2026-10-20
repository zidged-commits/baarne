// A browser signs its own requests. The gateway never receives owner private keys.
import {HUB_PRIVATE_VERSION,VAULT,PAIR,HANDOFF,NOTICE,canonical,hash,nonce,hubMessage,ownerMessage,accessMessage,pairMessage,handoffMessage,noticeMessage} from './private-protocol.mjs';
export class PrivateHubClient{
  #owner;#url;#fetch;#storage;#project;#fields;#context=null;#pending=null;#busy=false;
  constructor({owner,url,fetch:transport=globalThis.fetch.bind(globalThis),storage,projectIntroductionProfile,fields}){
    const endpoint=new URL(url);if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||!endpoint.port||endpoint.username||endpoint.password||!['','/'].includes(endpoint.pathname)||endpoint.search||endpoint.hash)throw Error('LOOPBACK_HUB_REQUIRED');
    if(!owner?.sign||!storage?.get||!storage?.put||!storage?.remove||typeof projectIntroductionProfile!=='function'||!Array.isArray(fields))throw Error('EXPLICIT_OWNER_STORAGE_AND_PROJECTION_REQUIRED');
    this.#owner=owner;this.#url=endpoint.origin;this.#fetch=transport;this.#storage=storage;this.#project=projectIntroductionProfile;this.#fields=fields;
  }
  get ownerKey(){return this.#owner.ownerKey;}
  context(){return structuredClone(this.#context);}
  pending(){return this.#pending!==null;}
  backup(){return this.#owner.backup();}
  async #post(path,value){
    const res=await this.#fetch(this.#url+'/private-api/'+path,{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json','X-BAARNE-Client':HUB_PRIVATE_VERSION},body:canonical(value),signal:AbortSignal.timeout(5000)});
    let size=0;const chunks=[];for await(const chunk of res.body){if((size+=chunk.length)>800000)throw Error('PRIVATE_RESPONSE_QUOTA');chunks.push(chunk);}
    const raw=new Uint8Array(size);let n=0;for(const part of chunks){raw.set(part,n);n+=part.length;}
    const result=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));if(res.status!==200)throw Error(result.error??'PRIVATE_OUTCOME_UNCONFIRMED');return result;
  }
  async request(operation,payload={}){
    const request={operation,payload},{challenge:c}=await this.#post('challenge',{ownerKey:this.ownerKey,requestHash:await hash(request)});
    if(c.version!==HUB_PRIVATE_VERSION||c.ownerKey!==this.ownerKey||c.requestHash!==await hash(request)||typeof c.nonce!=='string'||!/^[0-9a-f]{64}$/.test(c.nonce)||!Number.isSafeInteger(c.expiresAt)||this.#context&&c.sessionId!==this.#context.sessionId)throw Error('HUB_CHALLENGE_SCOPE_MISMATCH');
    return (await this.#post('request',{challenge:c,signature:await this.#owner.sign(hubMessage(c)),request})).result;
  }
  #journalContext(){return canonical({version:HUB_PRIVATE_VERSION,url:this.#url,sessionId:this.#context.sessionId,ownerKey:this.ownerKey});}
  #journalName(){return 'baarne-private-pending:'+this.#context.sessionId+':'+this.ownerKey;}
  async #savePending(pending){
    if(pending===null)await this.#storage.remove(this.#journalName());
    else await this.#storage.put(this.#journalName(),canonical(await this.#owner.seal(pending,this.#journalContext())));
    this.#pending=pending;
  }
  async attach({enroll=false}={}){
    this.#context=await this.request(enroll?'ENROLL':'CONTEXT');
    if(this.#context.ownerKey!==this.ownerKey||this.#context.productionAuthorized!==false)throw Error('WRONG_OWNER_CONTEXT');
    const sealed=await this.#storage.get(this.#journalName());if(sealed){if(sealed.length>100000)throw Error('PENDING_JOURNAL_QUOTA');this.#pending=await this.#owner.open(JSON.parse(sealed),this.#journalContext());}
    return this.context();
  }
  async refresh(){this.#context=await this.request('CONTEXT');return this.context();}
  async #record(body,message){return {body,signature:await this.#owner.sign(message(body))};}
  async #resolve(){
    const p=this.#pending;if(!p)throw Error('NO_PENDING_INTENT');const receipt=await this.request(p.operation,{kind:'STATUS',record:p.record});
    if(receipt.commandId!==await hash(p.record))throw Error('WRONG_COMMAND_RECEIPT');
    if(receipt.status==='APPLIED'){
      const expected=p.record.body.revision;if(receipt.appliedHead?.revision!==expected)throw Error('WRONG_RECEIPT_REVISION');
      await this.#savePending(null);await this.refresh();
    }else if(!['NOT_APPLIED','IN_PROGRESS'].includes(receipt.status))throw Error('UNKNOWN_RECEIPT_STATUS');
    return {status:receipt.status,context:this.context()};
  }
  async reconcile(){if(this.#busy)throw Error('CLIENT_BUSY');this.#busy=true;try{return await this.#resolve();}finally{this.#busy=false;}}
  async discardNotApplied(){if(this.#busy)throw Error('CLIENT_BUSY');this.#busy=true;try{const result=await this.#resolve();if(result.status!=='NOT_APPLIED')throw Error('UNCONFIRMED_DISCARD');await this.#savePending(null);await this.refresh();return result;}finally{this.#busy=false;}}
  async retryPending(){if(this.#busy||!this.#pending)throw Error('PENDING_INTENT_REQUIRED');this.#busy=true;try{const p=this.#pending;await this.request(p.operation,{kind:'COMMAND',record:p.record});return await this.#resolve();}catch(error){return {status:'UNKNOWN',reason:error.message};}finally{this.#busy=false;}}
  async #mutate(operation,body,message){
    if(this.#busy||this.pending())throw Error('RESOLVE_PENDING_INTENT_FIRST');this.#busy=true;
    try{const record=await this.#record(body,message);await this.#savePending({operation,record});
      try{await this.request(operation,{kind:'COMMAND',record});return await this.#resolve();}catch(error){return {status:'UNKNOWN',reason:error.message};}
    }finally{this.#busy=false;}
  }
  async vaultCommand(action,payload){await this.refresh();const h=this.#context.vaultHead;return this.#mutate('VAULT',{version:VAULT,scope:h.scope,revision:h.revision+1,action,payload},ownerMessage);}
  async exportProfile(){await this.refresh();const h=this.#context.vaultHead,body={version:VAULT,scope:h.scope,revision:h.revision,purpose:'OWNER_EXPORT',grantId:null,nonce:nonce()};
    const result=await this.request('VAULT',{kind:'OWNER_VIEW',record:await this.#record(body,accessMessage)});
    if(canonical(result.head)!==canonical(h)||result.profile.userId!==this.#context.actorId)throw Error('VAULT_EXPORT_SCOPE_CHANGED');return result.profile;
  }
  async pairAction(operation,payload={}){await this.refresh();const h=this.#context.pairHead;if(!h)throw Error('PEER_NOT_ENROLLED');return this.#mutate('PAIR',{version:PAIR,scope:h.scope,actorId:this.#context.actorId,revision:h.revision+1,actionId:'hub:'+nonce(),operation,payload},pairMessage);}
  async readPair(){await this.refresh();const h=this.#context.pairHead;if(!h)throw Error('PEER_NOT_ENROLLED');const body={version:PAIR,scope:h.scope,actorId:this.#context.actorId,revision:h.revision,actionId:'read:'+nonce(),operation:'READ',payload:{}};return this.request('PAIR',{kind:'READ',record:await this.#record(body,pairMessage)});}
  async syncSource(fields=this.#fields){
    const profile=await this.exportProfile(),c=this.#context;if(!c.pairHead)return {status:'PEER_NOT_ENROLLED'};
    if(!c.needsSourceSync)return {status:'APPLIED',context:this.context()};
    const body={version:HANDOFF,sourceHead:c.vaultHead,destination:c.pairHead.scope,actorId:c.actorId,fields:[...fields].sort(),profile:this.#project(profile,fields),nonce:nonce()};
    return this.pairAction('HANDOFF',{handoff:await this.#record(body,handoffMessage)});
  }
  async updateProfile(profile){const result=await this.vaultCommand('PROFILE',profile);if(result.status!=='APPLIED')return result;if(this.#context.pairHead)return this.syncSource();return result;}
  async enableDiscovery(fields=this.#fields,expiresAt=Math.floor(Date.now()/1000)+3600){await this.refresh();const c=this.#context;return this.vaultCommand('GRANT',{id:c.grantId,readerKey:c.readerKey,purpose:'DISCOVERY',fields,expiresAt});}
  async revokeDiscovery(){await this.refresh();return this.vaultCommand('REVOKE',{id:this.#context.grantId});}
  async discover(){return this.request('DISCOVER');}
  async sourceNotice(action,now){await this.refresh();const c=this.#context;if(!c.pairHead)throw Error('PEER_NOT_ENROLLED');
    const body={version:NOTICE,sourceHead:c.vaultHead,destination:c.pairHead.scope,actorId:c.actorId,action,sourceDeleted:action==='DELETE',now,nonce:nonce()};return this.pairAction('SOURCE_NOTICE',{notice:await this.#record(body,noticeMessage)});
  }
  async deleteProfile(now){const result=await this.vaultCommand('DELETE',{});if(result.status!=='APPLIED')return result;if(this.#context.pairHead)return this.sourceNotice('DELETE',now);return result;}
  lock(){this.#owner.lock();this.#context=null;this.#pending=null;}
}
