import {LifecycleJournal} from './lifecycle-journal.mjs';
import {applyLifecycleBlock,lifecycleView} from './lifecycle-v3.mjs';
export class LifecycleAbci{
  #journal;#pending=null;#busy=false;
  constructor(journal){this.#journal=journal;}
  static async create(directory,input){return new LifecycleAbci(await LifecycleJournal.create(directory,input.config,input.bootstrap));}
  static async load(directory,input){return new LifecycleAbci(await LifecycleJournal.loadForConsensus(directory,input.config,input.bootstrap));}
  info(){const v=this.#journal.view();return {height:v.document.height,stateHash:v.appHash,acceptedCount:Object.keys(v.document.seen).filter(k=>!k.startsWith('nonce:')).length};}
  exportState(){return this.#journal.view().document;}
  async checkIntent(raw){
    try{const engine=this.#journal.view().document;
      // Admission uses deterministic committed state. Dependent intents must
      // wait for their registration/recovery commit before being proposed.
      const row=await applyLifecycleBlock(engine,{height:engine.height+1,time:engine.time,txs:[raw]});
      return {code:row[0].status==='REJECTED'?1:0,reason:row[0].reason??row[0].status};
    }catch(e){return {code:1,reason:e.message};}
  }
  async stageBlock(height,time,txs){
    if(this.#busy||this.#pending)throw Error('COMMIT_REQUIRED');this.#busy=true;
    try{const engine=this.#journal.view().document,block={height,time,txs},rows=await applyLifecycleBlock(engine,block);this.#pending={block,hash:lifecycleView(engine).appHash};return {stateHash:this.#pending.hash,results:rows.map(r=>({code:r.status==='REJECTED'?1:0,reason:r.reason??r.status}))};}finally{this.#busy=false;}
  }
  async commit(){
    if(this.#busy||!this.#pending)throw Error('FINALIZE_REQUIRED');this.#busy=true;
    try{const result=await this.#journal.append(this.#pending.block);if(result.pin.appHash!==this.#pending.hash)throw Error('STAGED_COMMIT_MISMATCH');this.#pending=null;return this.info();}finally{this.#busy=false;}
  }
}
