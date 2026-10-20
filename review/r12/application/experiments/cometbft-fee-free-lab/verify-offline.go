// Fixed-validator synthetic lab verifier; not a general light client or M1 proof.
package main

import (
 "bytes"
 "crypto/ed25519"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "flag"
 "fmt"
 "io"
 "os"
 "regexp"
 "strings"

 dbm "github.com/cometbft/cometbft-db"
 abci "github.com/cometbft/cometbft/abci/types"
 cmtjson "github.com/cometbft/cometbft/libs/json"
 rpc "github.com/cometbft/cometbft/rpc/core/types"
 "github.com/cometbft/cometbft/store"
 "github.com/cometbft/cometbft/types"
)

const domain = "BAARNE_FEE_FREE_APPLICATION_LAB_V1"
const chain = "BAARNE_FEE_FREE_FINALITY_LAB_V1"
var keyPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var noncePattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
var signaturePattern = regexp.MustCompile(`^[0-9a-f]{128}$`)
var slotPattern = regexp.MustCompile(`^lab-slot-[a-z0-9]{1,12}$`)
func canonical(v interface{}) []byte { b,e:=json.Marshal(v);if e!=nil{panic(e)};return b }
func sum(v interface{}) []byte { h:=sha256.Sum256(canonical(v));return h[:] }
func textHash(v interface{}) string { return hex.EncodeToString(sum(v)) }
func boundedFile(path string) ([]byte,error) {
 f,e:=os.Open(path);if e!=nil{return nil,e};defer f.Close()
 b,e:=io.ReadAll(io.LimitReader(f,16*1024*1024+1));if e!=nil{return nil,e};if len(b)>16*1024*1024{return nil,errors.New("input too large")};return b,nil
}
type replay struct{ Hashes []string `json:"hashes"`;State json.RawMessage `json:"state"`;Info struct{Height int64 `json:"height"`;StateHash string `json:"stateHash"`;AcceptedCount int `json:"acceptedCount"`} `json:"info"` }
type packet struct{ Blocks []json.RawMessage `json:"blocks"`;BlockResults []json.RawMessage `json:"blockResults"`;Genesis json.RawMessage `json:"genesis"`;Replay replay `json:"replay"`;TerminalCommit json.RawMessage `json:"terminalCommit"` }
type trustedCheckpoint struct{ Height int64 `json:"height"`;BlockHash string `json:"blockHash"`;PartSetTotal uint32 `json:"partSetTotal"`;PartSetHash string `json:"partSetHash"` }
type execution struct{ slots map[string]string;genesisHash string;accepted []string;ids map[string]bool;nonces map[string]bool;occupied map[string]bool }
func newExecution(appState json.RawMessage) (*execution,error) {
 var g map[string]interface{};if e:=json.Unmarshal(appState,&g);e!=nil{return nil,e}
 slots,ok:=g["slots"].(map[string]interface{});if len(g)!=2||g["domain"]!=domain||!ok||len(slots)<1||len(slots)>16{return nil,errors.New("unsupported application genesis")}
 ex:=&execution{slots:map[string]string{},genesisHash:textHash(g),accepted:[]string{},ids:map[string]bool{},nonces:map[string]bool{},occupied:map[string]bool{}}
 for k,v:=range slots{s,ok:=v.(string);if !ok||!slotPattern.MatchString(k)||!keyPattern.MatchString(s){return nil,errors.New("invalid slot genesis")};ex.slots[k]=s}
 return ex,nil
}
func(ex *execution) apply(raw []byte) uint32 {
 if len(raw)>2048{return 1}
 var tx map[string]interface{};if json.Unmarshal(raw,&tx)!=nil||len(tx)!=3||!bytes.Equal(canonical(tx),raw){return 1}
 b,ok:=tx["body"].(map[string]interface{});if !ok||len(b)!=6{return 1}
 issuer,iok:=b["issuer"].(string);recipient,rok:=b["recipient"].(string);nonce,nok:=b["nonce"].(string);slot,sok:=b["slot"].(string)
 id,idok:=tx["id"].(string);signature,sigok:=tx["signature"].(string)
 if !iok||!rok||!nok||!sok||!idok||!sigok||b["domain"]!=domain||b["genesisHash"]!=ex.genesisHash||
 !keyPattern.MatchString(issuer)||!keyPattern.MatchString(recipient)||!noncePattern.MatchString(nonce)||!slotPattern.MatchString(slot)||
 ex.slots[slot]!=issuer||id!=textHash(b)||!signaturePattern.MatchString(signature){return 1}
 pub,_:=hex.DecodeString(issuer);sig,_:=hex.DecodeString(signature)
 if !ed25519.Verify(pub,canonical(b),sig){return 1}
 if ex.ids[id]{return 0};if ex.nonces[issuer+nonce]{return 2};if ex.occupied[slot]{return 3}
 ex.accepted=append(ex.accepted,string(raw));ex.ids[id]=true;ex.nonces[issuer+nonce]=true;ex.occupied[slot]=true;return 0
}
func(ex *execution) state(height int64) map[string]interface{} { return map[string]interface{}{"domain":domain,"genesisHash":ex.genesisHash,"height":height,"accepted":ex.accepted} }

type semanticProof struct { InitialState json.RawMessage `json:"initialState"`; Hashes []string `json:"hashes"`; Results [][]struct{Code uint32 `json:"code"`} `json:"results"`; State json.RawMessage `json:"state"`; Info struct{Height int64 `json:"height"`;StateHash string `json:"stateHash"`;AcceptedCount int `json:"acceptedCount"`} `json:"info"` }

func decodeTrustedCheckpoint(raw []byte)(*trustedCheckpoint,error){
 if len(raw)>4096{return nil,errors.New("INVALID_TRUSTED_CHECKPOINT")}
 var c trustedCheckpoint;d:=json.NewDecoder(bytes.NewReader(raw));d.DisallowUnknownFields();if d.Decode(&c)!=nil{return nil,errors.New("INVALID_TRUSTED_CHECKPOINT")};var extra interface{};if d.Decode(&extra)!=io.EOF{return nil,errors.New("INVALID_TRUSTED_CHECKPOINT")}
 canonicalBytes,_:=json.Marshal(c);if !bytes.Equal(bytes.TrimSpace(raw),canonicalBytes)||c.Height<1||c.PartSetTotal<1||c.PartSetTotal>1024||!regexp.MustCompile(`^[0-9a-fA-F]{64}$`).MatchString(c.BlockHash)||!regexp.MustCompile(`^[0-9a-fA-F]{64}$`).MatchString(c.PartSetHash){return nil,errors.New("INVALID_TRUSTED_CHECKPOINT")}
 return &c,nil
}
func verifyTrustedCheckpoint(blocks []rpc.ResultBlock,c *trustedCheckpoint)error{
 if c==nil{return nil};if c.Height>int64(len(blocks)){return errors.New("TRUSTED_CHECKPOINT_NOT_IN_PROOF")}
 b:=blocks[c.Height-1];hash,_:=hex.DecodeString(c.BlockHash);parts,_:=hex.DecodeString(c.PartSetHash);expected:=types.BlockID{Hash:hash,PartSetHeader:types.PartSetHeader{Total:c.PartSetTotal,Hash:parts}}
 if b.Block==nil||b.Block.Height!=c.Height||!b.BlockID.Equals(expected){return errors.New("TRUSTED_CHECKPOINT_MISMATCH")};return nil
}
func verify(packetBytes,genesisBytes []byte,pin string,semantic *semanticProof,checkpoint *trustedCheckpoint)(map[string]interface{},error){
 fail:=func(message string)(map[string]interface{},error){return nil,errors.New(message)}
 anchor:=sha256.Sum256(genesisBytes);if hex.EncodeToString(anchor[:])!=pin{return fail("GENESIS_ANCHOR_MISMATCH")}
 doc,e:=types.GenesisDocFromJSON(genesisBytes);if e!=nil{return nil,e}
 if doc.ChainID!=chain||doc.InitialHeight!=1||len(doc.Validators)!=4{return fail("UNSUPPORTED_GENESIS_SCOPE")}
 validators:=make([]*types.Validator,0,4)
 for _,v:=range doc.Validators{if v.PubKey==nil||v.PubKey.Type()!="ed25519"||v.Power!=1{return fail("UNSUPPORTED_VALIDATOR_SET")};validators=append(validators,types.NewValidator(v.PubKey,v.Power))}
 set:=types.NewValidatorSet(validators)
 var p packet;if e=json.Unmarshal(packetBytes,&p);e!=nil{return nil,e}
 if len(p.Blocks)<2||len(p.Blocks)>5000||len(p.BlockResults)!=len(p.Blocks)-1||len(p.Replay.Hashes)!=len(p.BlockResults)||len(p.TerminalCommit)==0{return fail("INCOMPLETE_PROOF")}
 var supplied,anchored interface{};if json.Unmarshal(p.Genesis,&supplied)!=nil||json.Unmarshal(doc.AppState,&anchored)!=nil||!bytes.Equal(canonical(supplied),canonical(anchored)){return fail("APPLICATION_GENESIS_MISMATCH")}
 var ex *execution;var initialHash []byte
 if semantic==nil {ex,e=newExecution(doc.AppState);if e!=nil{return nil,e};initialHash=sum(ex.state(0))} else {
  g,ok:=anchored.(map[string]interface{});v3:=false;if ok{cfg,cfgok:=g["config"].(map[string]interface{});_,bootok:=g["bootstrap"].([]interface{});v3=len(g)==2&&cfgok&&bootok&&cfg["domain"]=="BAARNE_SYNTHETIC_LIFECYCLE_V3"&&cfg["mode"]=="ISOLATED_SYNTHETIC_LAB"&&len(p.BlockResults)<=1000}
  if !ok||!((len(g)==3&&g["domain"]=="BAARNE_FEE_FREE_MEMBERSHIP_LAB_V1"&&len(p.BlockResults)<=128)||(len(g)==4&&g["domain"]=="BAARNE_FEE_FREE_MEMBERSHIP_RECOVERY_LAB_V2")||v3){return fail("UNSUPPORTED_MEMBERSHIP_SCOPE")}
  if len(semantic.Hashes)!=len(p.BlockResults)||len(semantic.Results)!=len(p.BlockResults){return fail("INCOMPLETE_SEMANTIC_REPLAY")}
  var initial interface{};if json.Unmarshal(semantic.InitialState,&initial)!=nil{return fail("INVALID_INITIAL_STATE")};initialHash=sum(initial)
 }
 blocks:=make([]rpc.ResultBlock,len(p.Blocks))
 for i,raw:=range p.Blocks{
  if e=cmtjson.Unmarshal(raw,&blocks[i]);e!=nil{return nil,e};b:=blocks[i].Block;if b==nil{return fail("MISSING_BLOCK")}
  if e=b.ValidateBasic();e!=nil{return nil,e}
  if b.Height!=int64(i+1)||b.ChainID!=chain||b.Version.App!=1||b.Version.Block!=11||len(b.Data.Txs)>64||len(b.Evidence.Evidence)!=0{return fail("BLOCK_SCOPE_OR_ORDER_MISMATCH")}
  if !bytes.Equal(b.ValidatorsHash,set.Hash())||!bytes.Equal(b.NextValidatorsHash,set.Hash())||!bytes.Equal(b.ConsensusHash,doc.ConsensusParams.Hash()){return fail("VALIDATOR_OR_PARAMS_MISMATCH")}
  if index,_:=set.GetByAddress(b.ProposerAddress);index<0{return fail("UNKNOWN_PROPOSER")}
  parts,err:=b.MakePartSet(types.BlockPartSizeBytes);if err!=nil{return nil,err};id:=types.BlockID{Hash:b.Header.Hash(),PartSetHeader:parts.Header()}
  if !blocks[i].BlockID.Equals(id){return fail("BLOCK_ID_MISMATCH")}
  if i==0{if !b.LastBlockID.IsZero()||b.LastCommit.Height!=0||len(b.LastCommit.Signatures)!=0||!b.Time.Equal(doc.GenesisTime)||!bytes.Equal(b.AppHash,initialHash){return fail("INITIAL_BLOCK_MISMATCH")}}
  if i>0{if !b.LastBlockID.Equals(blocks[i-1].BlockID)||!b.Time.After(blocks[i-1].Block.Time){return fail("PARENT_OR_TIME_MISMATCH")}}
 }
 var terminal types.Commit;if e=cmtjson.Unmarshal(p.TerminalCommit,&terminal);e!=nil{return nil,e}
 for i,b:=range blocks{
  commit:=&terminal;if i+1<len(blocks){commit=blocks[i+1].Block.LastCommit}
  if e=commit.ValidateBasic();e!=nil{return nil,e}
  if e=set.VerifyCommit(chain,b.BlockID,b.Block.Height,commit);e!=nil{return nil,fmt.Errorf("COMMIT_VERIFICATION_FAILED height %d: %w",b.Block.Height,e)}
 }
 if e=verifyTrustedCheckpoint(blocks,checkpoint);e!=nil{return fail(e.Error())}
 for i,raw:=range p.BlockResults{
  var r rpc.ResultBlockResults;if e=cmtjson.Unmarshal(raw,&r);e!=nil{return nil,e}
  if r.Height!=int64(i+1)||len(r.TxsResults)!=len(blocks[i].Block.Data.Txs)||len(r.ValidatorUpdates)!=0||r.ConsensusParamUpdates!=nil{return fail("UNSUPPORTED_EXECUTION_RESULT")}
  expected:=make([]*abci.ExecTxResult,0,len(r.TxsResults))
  var hash []byte
  if semantic==nil {
   for _,tx:=range blocks[i].Block.Data.Txs{expected=append(expected,&abci.ExecTxResult{Code:ex.apply(tx)})}
   hash=sum(ex.state(int64(i+1)))
  }else{
   if len(semantic.Results[i])!=len(r.TxsResults){return fail("SEMANTIC_RESULT_COUNT_MISMATCH")}
   for _,result:=range semantic.Results[i]{if result.Code>1{return fail("INVALID_SEMANTIC_CODE")};expected=append(expected,&abci.ExecTxResult{Code:result.Code})}
   if !keyPattern.MatchString(semantic.Hashes[i]){return fail("INVALID_SEMANTIC_HASH")};hash,_=hex.DecodeString(semantic.Hashes[i])
  }
  next:=blocks[i+1].Block
  if !bytes.Equal(hash,r.AppHash)||!bytes.Equal(hash,next.AppHash)||p.Replay.Hashes[i]!=hex.EncodeToString(hash){return fail("APPLICATION_HASH_MISMATCH")}
  computed:=types.NewResults(expected).Hash();if !bytes.Equal(computed,types.NewResults(r.TxsResults).Hash())||!bytes.Equal(computed,next.LastResultsHash){return fail("EXECUTION_RESULTS_MISMATCH")}
 }
 var replayState interface{};if json.Unmarshal(p.Replay.State,&replayState)!=nil{return fail("REPLAY_STATE_MISMATCH")}
 var expectedState interface{};var accepted int
 if semantic==nil {expectedState=ex.state(int64(len(p.BlockResults)));accepted=len(ex.accepted)}else{
  if json.Unmarshal(semantic.State,&expectedState)!=nil{return fail("INVALID_SEMANTIC_STATE")}
  state,ok:=expectedState.(map[string]interface{});if !ok{return fail("INVALID_SEMANTIC_STATE")}
  if state["anchor"]!=nil {cfg,cfgok:=state["config"].(map[string]interface{});seen,seenok:=state["seen"].(map[string]interface{});if !cfgok||!seenok||cfg["domain"]!="BAARNE_SYNTHETIC_LIFECYCLE_V3"{return fail("INVALID_SEMANTIC_STATE")};for k,v:=range seen{if !strings.HasPrefix(k,"nonce:"){if !keyPattern.MatchString(k)||v!=true{return fail("INVALID_SEMANTIC_STATE")};accepted++}}}else{items,ok:=state["accepted"].([]interface{});if !ok{return fail("INVALID_SEMANTIC_STATE")};accepted=len(items)}
  h:=textHash(expectedState)
  if h!=semantic.Hashes[len(semantic.Hashes)-1]||semantic.Info.StateHash!=h||semantic.Info.Height!=int64(len(p.BlockResults))||semantic.Info.AcceptedCount!=accepted{return fail("SEMANTIC_FINAL_STATE_MISMATCH")}
 }
 if !bytes.Equal(canonical(replayState),canonical(expectedState))||p.Replay.Info.Height!=int64(len(p.BlockResults))||p.Replay.Info.StateHash!=textHash(replayState)||p.Replay.Info.AcceptedCount!=accepted{return fail("REPLAY_STATE_MISMATCH")}
 mode:="INDEPENDENT_GO_SLOT_REPLAY";if semantic!=nil{mode="GO_CONSENSUS_PLUS_NODE_MEMBERSHIP_REPLAY"}
 result:=map[string]interface{}{"status":"OFFLINE_LAB_PROOF_PASS","executionVerification":mode,"certifiedBlockHeight":len(blocks),"verifiedStateHeight":len(p.BlockResults),
 "stateHash":textHash(replayState),"acceptedCount":accepted,"genesisSha256":pin,"livePilotAuthorized":false,"freshnessProven":false,"trustedCheckpointStatus":"NOT_PROVIDED"}
 if checkpoint!=nil{result["trustedCheckpointStatus"]="MATCHED_VERIFIED_PREFIX";result["trustedCheckpointHeight"]=checkpoint.Height;result["extendsTrustedCheckpoint"]=true}
 return result,nil
}
func main(){
 packetFile:=flag.String("packet","","public proof packet");genesisFile:=flag.String("genesis","","public Genesis");pin:=flag.String("genesis-sha256","","separately pinned Genesis SHA256")
 semanticFile:=flag.String("membership-replay","","network-free recomputed membership replay (not a standalone certificate)")
 checkpointFile:=flag.String("trusted-checkpoint","","separately supplied exact certified BlockID floor (does not prove latest state)")
 dbDir:=flag.String("export-db","","COPY of public blockstore directory");height:=flag.Int64("export-height",0,"commit height to export");exportBlocks:=flag.Bool("export-blocks",false,"export public blocks through height instead of commit");flag.Parse()
 if *dbDir!=""{if *height<1||*height>5000{panic("bounded positive height required")};db,e:=dbm.NewDB("blockstore",dbm.GoLevelDBBackend,*dbDir);if e!=nil{panic(e)};defer db.Close()
  bs:=store.NewBlockStore(db)
  if *exportBlocks{blocks:=make([]rpc.ResultBlock,0,*height);for h:=int64(1);h<=*height;h++{block:=bs.LoadBlock(h);meta:=bs.LoadBlockMeta(h);if block==nil||meta==nil{panic("block unavailable")};blocks=append(blocks,rpc.ResultBlock{BlockID:meta.BlockID,Block:block})};b,e:=cmtjson.Marshal(blocks);if e!=nil||len(b)>16*1024*1024{panic("export invalid or too large")};fmt.Println(string(b));return}
  commit:=bs.LoadSeenCommit(*height);if commit==nil{commit=bs.LoadBlockCommit(*height)};if commit==nil{panic("commit unavailable")}
  b,e:=cmtjson.Marshal(commit);if e!=nil{panic(e)};fmt.Println(string(b));return}
 if *packetFile==""||*genesisFile==""||!keyPattern.MatchString(*pin){panic("packet, genesis and external SHA256 pin required")}
 pb,e:=boundedFile(*packetFile);if e!=nil{panic(e)};gb,e:=boundedFile(*genesisFile);if e!=nil{panic(e)}
 var semantic *semanticProof
 if *semanticFile!="" {raw,err:=boundedFile(*semanticFile);if err!=nil{panic(err)};semantic=&semanticProof{};if err=json.Unmarshal(raw,semantic);err!=nil{panic(err)}}
 var checkpoint *trustedCheckpoint
 if *checkpointFile!=""{raw,err:=boundedFile(*checkpointFile);if err!=nil{panic(err)};checkpoint,err=decodeTrustedCheckpoint(raw);if err!=nil{fmt.Fprintln(os.Stderr,err);os.Exit(1)}}
 result,e:=verify(pb,gb,*pin,semantic,checkpoint);if e!=nil{fmt.Fprintln(os.Stderr,e);os.Exit(1)};b,e:=json.Marshal(result);if e!=nil{panic(e)};fmt.Println(string(b))
}
