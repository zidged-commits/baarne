// Linux-only synthetic ABCI bridge. Uses the pinned upstream server and types.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/cometbft/cometbft/abci/server"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/libs/log"
)

type info struct {
	Height        int64  `json:"height"`
	StateHash     string `json:"stateHash"`
	AcceptedCount int64  `json:"acceptedCount"`
}
type txResult struct {
	Code   uint32 `json:"code"`
	Reason string `json:"reason"`
}
type capacity struct {
	Blocks struct {
		Used      int64 `json:"used"`
		Limit     int64 `json:"limit"`
		Remaining int64 `json:"remaining"`
	} `json:"blocks"`
}
type app struct {
	abci.BaseApplication
	mu           sync.Mutex
	transport    *workerTransport
	segmented    bool
	haltOnQuota  bool
	haltSettle   time.Duration
	quotaLimit   int64
	haltEvidence string
	instanceID   string
}

type quotaHaltEvidence struct {
	Status                      string `json:"status"`
	BridgeInstance              string `json:"bridgeInstance"`
	Height                      int64  `json:"height"`
	AcceptedCount               int64  `json:"acceptedCount"`
	BlockHash                   string `json:"blockHash"`
	ApplicationHash             string `json:"applicationHash"`
	BlockAppHash                string `json:"blockAppHash"`
	BlockResultsAppHash         string `json:"blockResultsAppHash"`
	PreviousBlockResultsAppHash string `json:"previousBlockResultsAppHash"`
	ConsensusHeight             int64  `json:"consensusHeight"`
	ABCIInfoHeight              int64  `json:"abciInfoHeight"`
	ABCIInfoAppHash             string `json:"abciInfoAppHash"`
	CatchingUp                  bool   `json:"catchingUp"`
	SettleDurationMS            int64  `json:"settleDurationMs"`
}

type statusResponse struct {
	Result struct {
		SyncInfo struct {
			LatestBlockHash   string `json:"latest_block_hash"`
			LatestBlockHeight string `json:"latest_block_height"`
			CatchingUp        bool   `json:"catching_up"`
		} `json:"sync_info"`
	} `json:"result"`
}

type abciInfoResponse struct {
	Result struct {
		Response struct {
			LastBlockHeight  string `json:"last_block_height"`
			LastBlockAppHash string `json:"last_block_app_hash"`
		} `json:"response"`
	} `json:"result"`
}

type blockResponse struct {
	Result struct {
		Block struct {
			Header struct {
				Height  string `json:"height"`
				AppHash string `json:"app_hash"`
			} `json:"header"`
		} `json:"block"`
		BlockID struct {
			Hash string `json:"hash"`
		} `json:"block_id"`
	} `json:"result"`
}

type blockResultsResponse struct {
	Result struct {
		Height  string `json:"height"`
		AppHash string `json:"app_hash"`
	} `json:"result"`
}

func localRPC(path string, target interface{}) error {
	client := &http.Client{Timeout: 750 * time.Millisecond}
	response, err := client.Get("http://127.0.0.1:26657" + path)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("local RPC returned HTTP %d", response.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(response.Body, 65536)).Decode(target)
}

func (a *app) quotaCommitProof() (quotaHaltEvidence, bool, string) {
	var result quotaHaltEvidence
	if !a.haltOnQuota || !a.segmented {
		return result, false, "quota halt disabled or non-segmented app"
	}
	var limits capacity
	var application info
	if a.call(map[string]interface{}{"method": "capacity"}, &limits) != nil ||
		a.call(map[string]interface{}{"method": "info"}, &application) != nil {
		return result, false, "application status unavailable"
	}
	if limits.Blocks.Remaining != 0 || limits.Blocks.Used != a.quotaLimit || application.Height != a.quotaLimit {
		return result, false, "application has not reached exact terminal quota"
	}
	var status statusResponse
	if err := localRPC("/status", &status); err != nil {
		return result, false, "consensus status unavailable: " + err.Error()
	}
	if status.Result.SyncInfo.CatchingUp {
		return result, false, "consensus node is catching up"
	}
	consensusHeight, err := strconv.ParseInt(status.Result.SyncInfo.LatestBlockHeight, 10, 64)
	blockHash, hashErr := hex.DecodeString(status.Result.SyncInfo.LatestBlockHash)
	if err != nil || hashErr != nil || len(blockHash) != 32 || consensusHeight != a.quotaLimit {
		return result, false, "consensus height or block hash is invalid"
	}
	var abciInfo abciInfoResponse
	if err := localRPC("/abci_info", &abciInfo); err != nil {
		return result, false, "ABCI info unavailable: " + err.Error()
	}
	var committedBlock blockResponse
	if err := localRPC("/block?height="+strconv.FormatInt(a.quotaLimit, 10), &committedBlock); err != nil {
		return result, false, "committed block unavailable: " + err.Error()
	}
	var committedResults blockResultsResponse
	if err := localRPC("/block_results?height="+strconv.FormatInt(a.quotaLimit, 10), &committedResults); err != nil {
		return result, false, "committed block results unavailable: " + err.Error()
	}
	abciHeight, err := strconv.ParseInt(abciInfo.Result.Response.LastBlockHeight, 10, 64)
	abciHash, hashErr := base64.StdEncoding.DecodeString(abciInfo.Result.Response.LastBlockAppHash)
	blockHeight, blockHeightErr := strconv.ParseInt(committedBlock.Result.Block.Header.Height, 10, 64)
	blockAppHash, blockAppHashErr := hex.DecodeString(committedBlock.Result.Block.Header.AppHash)
	blockResultsHeight, blockResultsHeightErr := strconv.ParseInt(committedResults.Result.Height, 10, 64)
	blockResultsAppHash, blockResultsAppHashErr := base64.StdEncoding.DecodeString(committedResults.Result.AppHash)
	applicationHash, appHashErr := hash(application.StateHash)
	if err != nil || hashErr != nil || blockHeightErr != nil || blockAppHashErr != nil ||
		blockResultsHeightErr != nil || blockResultsAppHashErr != nil || appHashErr != nil ||
		abciHeight != application.Height || blockHeight != consensusHeight || blockResultsHeight != consensusHeight ||
		committedBlock.Result.BlockID.Hash != status.Result.SyncInfo.LatestBlockHash ||
		!bytes.Equal(abciHash, applicationHash) || !bytes.Equal(blockResultsAppHash, applicationHash) ||
		len(abciHash) != 32 || len(blockAppHash) != 32 || len(blockResultsAppHash) != 32 {
		return result, false, "committed block results, ABCI info, and application hashes differ or are malformed"
	}
	var previousAppHash []byte
	if application.Height > 1 {
		var previousResults blockResultsResponse
		if err := localRPC("/block_results?height="+strconv.FormatInt(application.Height-1, 10), &previousResults); err != nil {
			return result, false, "previous committed block results unavailable: " + err.Error()
		}
		previousHeight, previousHeightErr := strconv.ParseInt(previousResults.Result.Height, 10, 64)
		var previousAppHashErr error
		previousAppHash, previousAppHashErr = base64.StdEncoding.DecodeString(previousResults.Result.AppHash)
		if previousHeightErr != nil || previousAppHashErr != nil || previousHeight != application.Height-1 ||
			len(previousAppHash) != 32 || !bytes.Equal(blockAppHash, previousAppHash) {
			return result, false, "block header app hash does not match previous committed application result"
		}
	}
	result = quotaHaltEvidence{
		Status:                      "COMMITTED_QUOTA_TERMINAL",
		BridgeInstance:              a.instanceID,
		Height:                      application.Height,
		AcceptedCount:               application.AcceptedCount,
		BlockHash:                   hex.EncodeToString(blockHash),
		ApplicationHash:             hex.EncodeToString(applicationHash),
		BlockAppHash:                hex.EncodeToString(blockAppHash),
		BlockResultsAppHash:         hex.EncodeToString(blockResultsAppHash),
		PreviousBlockResultsAppHash: hex.EncodeToString(previousAppHash),
		ConsensusHeight:             consensusHeight,
		ABCIInfoHeight:              abciHeight,
		ABCIInfoAppHash:             hex.EncodeToString(abciHash),
		CatchingUp:                  false,
	}
	return result, true, ""
}

func (a *app) watchQuotaCommit(stop chan<- struct{}) {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	lastReason := ""
	candidateKey := ""
	var proofSince time.Time
	var writeRetryAt time.Time
	var writeRetryDelay time.Duration
	var lastWriteFailureLog time.Time
	var writeFailureCount uint64
	for range ticker.C {
		evidence, ready, reason := a.quotaCommitProof()
		if !ready {
			candidateKey = ""
			proofSince = time.Time{}
			if reason != lastReason {
				fmt.Fprintf(os.Stderr, "BAARNE_QUOTA_HALT_WAIT reason=%q\n", reason)
				lastReason = reason
			}
			continue
		}
		encoded, err := json.Marshal(evidence)
		if err != nil {
			fmt.Fprintf(os.Stderr, "BAARNE_QUOTA_HALT_EVIDENCE_ENCODE_FAILED error=%q\n", err.Error())
			continue
		}
		key := string(encoded)
		if key != candidateKey {
			candidateKey = key
			proofSince = time.Now()
			writeRetryAt = time.Time{}
			writeRetryDelay = 0
			lastWriteFailureLog = time.Time{}
			writeFailureCount = 0
			continue
		}
		if time.Since(proofSince) < a.haltSettle {
			continue
		}
		if !writeRetryAt.IsZero() && time.Now().Before(writeRetryAt) {
			continue
		}
		evidence.SettleDurationMS = a.haltSettle.Milliseconds()
		if err := writeExclusiveJSON(a.haltEvidence, evidence); err != nil {
			writeFailureCount++
			if shouldLogQuotaHaltWriteFailure(time.Now(), lastWriteFailureLog) {
				fmt.Fprintf(os.Stderr, "BAARNE_QUOTA_HALT_EVIDENCE_WRITE_FAILED attempts=%d error=%q\n", writeFailureCount, err.Error())
				lastWriteFailureLog = time.Now()
			}
			writeRetryDelay = nextQuotaHaltWriteRetry(writeRetryDelay)
			writeRetryAt = time.Now().Add(writeRetryDelay)
			continue
		}
		fmt.Fprintf(os.Stderr, "BAARNE_QUOTA_HALT_CONFIRMED height=%d block_hash=%s app_hash=%s\n",
			evidence.Height, evidence.BlockHash, evidence.ApplicationHash)
		stop <- struct{}{}
		return
	}
}

func (a *app) call(q interface{}, target interface{}) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	raw, err := json.Marshal(q)
	if err != nil {
		return err
	}
	response, err := a.transport.Call(raw)
	if err != nil {
		return err
	}
	r, err := decodeWorkerAnswer(response)
	if err != nil {
		return err
	}
	if !r.OK {
		return fmt.Errorf("worker: %s", r.Error)
	}
	if err := validateWorkerResultJSON(r.Result); err != nil {
		return err
	}
	return json.Unmarshal(r.Result, target)
}
func hash(text string) ([]byte, error) {
	raw, err := hex.DecodeString(text)
	if err != nil || len(raw) != 32 {
		return nil, errors.New("invalid application hash")
	}
	return raw, nil
}
func (a *app) Info(context.Context, *abci.RequestInfo) (*abci.ResponseInfo, error) {
	var r info
	if err := a.call(map[string]interface{}{"method": "info"}, &r); err != nil {
		return nil, err
	}
	h, err := hash(r.StateHash)
	return &abci.ResponseInfo{LastBlockHeight: r.Height, LastBlockAppHash: h, AppVersion: 1}, err
}
func (a *app) InitChain(_ context.Context, q *abci.RequestInitChain) (*abci.ResponseInitChain, error) {
	var r info
	if err := a.call(map[string]interface{}{"method": "init", "chainId": q.ChainId, "genesis": string(q.AppStateBytes)}, &r); err != nil {
		return nil, err
	}
	h, err := hash(r.StateHash)
	return &abci.ResponseInitChain{AppHash: h}, err
}
func (a *app) CheckTx(_ context.Context, q *abci.RequestCheckTx) (*abci.ResponseCheckTx, error) {
	if a.segmented {
		c, err := a.blockCapacity()
		if err != nil {
			return nil, err
		}
		if c.Blocks.Remaining <= 0 {
			return &abci.ResponseCheckTx{Code: 1, Log: "BLOCK_QUOTA"}, nil
		}
	}
	var r txResult
	if err := a.call(map[string]interface{}{"method": "check", "tx": q.Tx}, &r); err != nil {
		return nil, err
	}
	return &abci.ResponseCheckTx{Code: r.Code, Log: r.Reason}, nil
}
func (a *app) blockCapacity() (capacity, error) {
	var c capacity
	err := a.call(map[string]interface{}{"method": "capacity"}, &c)
	return c, err
}
func (a *app) PrepareProposal(ctx context.Context, q *abci.RequestPrepareProposal) (*abci.ResponsePrepareProposal, error) {
	r := &abci.ResponsePrepareProposal{}
	var size int64
	if a.segmented {
		c, err := a.blockCapacity()
		if err != nil {
			return nil, err
		}
		if q.Height != c.Blocks.Used+1 || q.Height > c.Blocks.Limit {
			return r, nil
		}
	}
	for _, tx := range q.Txs {
		if len(r.Txs) == 64 || size+int64(len(tx)) > q.MaxTxBytes || size+int64(len(tx)) > 131072 {
			break
		}
		checked, err := a.CheckTx(ctx, &abci.RequestCheckTx{Tx: tx})
		if err != nil {
			return nil, err
		}
		if checked.Code == 0 {
			r.Txs = append(r.Txs, tx)
			size += int64(len(tx))
		}
	}
	return r, nil
}
func (a *app) ProcessProposal(ctx context.Context, q *abci.RequestProcessProposal) (*abci.ResponseProcessProposal, error) {
	status := abci.ResponseProcessProposal_ACCEPT
	var size int64
	for _, tx := range q.Txs {
		size += int64(len(tx))
	}
	if len(q.Txs) > 64 || size > 131072 {
		return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, nil
	}
	if a.segmented {
		c, err := a.blockCapacity()
		if err != nil {
			return nil, err
		}
		if q.Height != c.Blocks.Used+1 || q.Height > c.Blocks.Limit {
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, nil
		}
	}
	for _, tx := range q.Txs {
		checked, err := a.CheckTx(ctx, &abci.RequestCheckTx{Tx: tx})
		if err != nil {
			return nil, err
		}
		if checked.Code != 0 {
			status = abci.ResponseProcessProposal_REJECT
			break
		}
	}
	return &abci.ResponseProcessProposal{Status: status}, nil
}
func (a *app) FinalizeBlock(_ context.Context, q *abci.RequestFinalizeBlock) (*abci.ResponseFinalizeBlock, error) {
	var r struct {
		Results   []txResult `json:"results"`
		StateHash string     `json:"stateHash"`
	}
	if err := a.call(map[string]interface{}{"method": "finalize", "height": q.Height, "time": q.Time.Unix(), "txs": q.Txs}, &r); err != nil {
		return nil, err
	}
	if len(r.Results) != len(q.Txs) {
		return nil, errors.New("result count mismatch")
	}
	out := &abci.ResponseFinalizeBlock{}
	for _, tx := range r.Results {
		out.TxResults = append(out.TxResults, &abci.ExecTxResult{Code: tx.Code, Log: tx.Reason})
	}
	h, err := hash(r.StateHash)
	out.AppHash = h
	return out, err
}
func (a *app) Commit(context.Context, *abci.RequestCommit) (*abci.ResponseCommit, error) {
	var r info
	if err := a.call(map[string]interface{}{"method": "commit"}, &r); err != nil {
		return nil, err
	}
	return &abci.ResponseCommit{}, nil
}
func (a *app) Query(_ context.Context, q *abci.RequestQuery) (*abci.ResponseQuery, error) {
	if q.Path != "/state" || q.Height != 0 || q.Prove {
		return &abci.ResponseQuery{Code: 1, Log: "UNSUPPORTED_QUERY_OR_PROOF"}, nil
	}
	var r json.RawMessage
	if err := a.call(map[string]interface{}{"method": "query"}, &r); err != nil {
		return nil, err
	}
	var snapshot struct {
		Info info `json:"info"`
	}
	if err := json.Unmarshal(r, &snapshot); err != nil {
		return nil, err
	}
	return &abci.ResponseQuery{Value: r, Height: snapshot.Info.Height}, nil
}
func main() {
	state := flag.String("state", "", "existing application store")
	genesis := flag.String("genesis", "", "public synthetic genesis")
	worker := flag.String("worker", "", "Node worker path")
	flag.Parse()
	if *state == "" || *genesis == "" || *worker == "" {
		panic("state/genesis/worker required")
	}
	haltOnQuota := os.Getenv("BAARNE_HALT_ON_QUOTA") == "1"
	settleText := os.Getenv("BAARNE_QUOTA_HALT_SETTLE_MS")
	settleMs := int64(0)
	var settleErr error
	if settleText != "" {
		settleMs, settleErr = strconv.ParseInt(settleText, 10, 64)
	}
	if settleErr != nil || settleMs < 0 || settleMs > 30000 {
		panic("invalid quota halt settle interval")
	}
	if haltOnQuota && os.Getenv("BAARNE_SEGMENTED_LAB") != "1" {
		panic("quota halt requires isolated segmented lab mode")
	}
	lock, err := os.OpenFile(filepath.Join(*state, "writer.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		panic(err)
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		panic("application writer already owned")
	}
	child := exec.Command("node", *worker, *state, *genesis)
	child.Stderr = os.Stderr
	child.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
	input, err := child.StdinPipe()
	if err != nil {
		panic(err)
	}
	output, err := child.StdoutPipe()
	if err != nil {
		panic(err)
	}
	if err = child.Start(); err != nil {
		panic(err)
	}
	defer child.Process.Kill()
	instanceBytes := make([]byte, 16)
	if _, err = rand.Read(instanceBytes); err != nil {
		panic(err)
	}
	application := &app{
		transport:   newWorkerTransport(input, output, 5*time.Second, child.Process.Kill),
		segmented:   os.Getenv("BAARNE_SEGMENTED_LAB") == "1",
		haltOnQuota: haltOnQuota, haltSettle: time.Duration(settleMs) * time.Millisecond,
		haltEvidence: filepath.Join(filepath.Dir(*state), "quota-halt-evidence.json"),
		instanceID:   hex.EncodeToString(instanceBytes),
	}
	if _, err = application.Info(context.Background(), &abci.RequestInfo{}); err != nil {
		panic(err)
	}
	if haltOnQuota {
		var limits capacity
		if err = application.call(map[string]interface{}{"method": "capacity"}, &limits); err != nil {
			panic(err)
		}
		application.quotaLimit = limits.Blocks.Limit
		if application.quotaLimit < 1 || limits.Blocks.Used > application.quotaLimit {
			panic("invalid segmented quota state")
		}
	}
	service, err := server.NewServer("tcp://127.0.0.1:26658", "socket", application)
	if err != nil {
		panic(err)
	}
	service.SetLogger(log.NewNopLogger())
	if err = service.Start(); err != nil {
		panic(err)
	}
	if haltOnQuota {
		if err = writeExclusiveJSON(filepath.Join(filepath.Dir(*state), "abci-ready.json"), map[string]string{"status": "ABCI_READY"}); err != nil {
			panic(err)
		}
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT)
	quotaHalt := make(chan struct{}, 1)
	if haltOnQuota {
		go application.watchQuotaCommit(quotaHalt)
	}
	select {
	case <-signals:
	case <-quotaHalt:
	}
	_ = service.Stop()
}
