package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"
)

const workerMaxMessageBytes = 262144
const workerFrameOverheadBytes = 64
const workerMaxFrameBytes = workerMaxMessageBytes + workerFrameOverheadBytes

var errWorkerUnavailable = errors.New("worker unavailable")
var errWorkerTimeout = errors.New("worker response timeout; outcome is unconfirmed")

type workerLine struct {
	value  []byte
	id     uint64
	err    error
	readAt time.Time
}

type workerRequestFrame struct {
	ID      uint64          `json:"id"`
	Request json.RawMessage `json:"request"`
}

type workerResponseFrame struct {
	ID       uint64          `json:"id"`
	Response json.RawMessage `json:"response"`
}

type workerAnswer struct {
	OK     bool
	Error  string
	Result json.RawMessage
}

// workerTransport serializes JSONL requests and has no retry path: after a
// timeout, a late response could otherwise be mistaken for a later request.
type workerTransport struct {
	mu       sync.Mutex
	input    io.WriteCloser
	output   io.ReadCloser
	lines    chan workerLine
	done     chan struct{}
	timeout  time.Duration
	kill     func() error
	failed   error
	nextID   uint64
	stopOnce sync.Once
}

func newWorkerTransport(input io.WriteCloser, output io.ReadCloser, timeout time.Duration, kill func() error) *workerTransport {
	t := &workerTransport{
		input: input, output: output, lines: make(chan workerLine, 1),
		done: make(chan struct{}), timeout: timeout, kill: kill,
	}
	go t.readLines()
	return t
}

func decodeWorkerResponseFrame(raw []byte) (workerResponseFrame, error) {
	var frame workerResponseFrame
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return frame, errors.New("invalid worker response envelope")
	}
	seen := make(map[string]bool, 2)
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return frame, errors.New("invalid worker response envelope")
		}
		key, ok := token.(string)
		if !ok || seen[key] {
			return frame, errors.New("duplicate or invalid worker response field")
		}
		seen[key] = true
		switch key {
		case "id":
			err = decoder.Decode(&frame.ID)
		case "response":
			err = decoder.Decode(&frame.Response)
		default:
			return frame, fmt.Errorf("unknown worker response field: %s", key)
		}
		if err != nil {
			return frame, errors.New("invalid worker response field")
		}
	}
	token, err = decoder.Token()
	if err != nil || token != json.Delim('}') || len(seen) != 2 || frame.ID == 0 || len(frame.Response) == 0 {
		return frame, errors.New("incomplete worker response envelope")
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return frame, errors.New("trailing worker response data")
	}
	return frame, nil
}

func decodeWorkerAnswer(raw []byte) (workerAnswer, error) {
	var answer workerAnswer
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return answer, errors.New("invalid worker answer")
	}
	seen := make(map[string]bool, 3)
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return answer, errors.New("invalid worker answer")
		}
		key, ok := token.(string)
		if !ok || seen[key] {
			return answer, errors.New("duplicate or invalid worker answer field")
		}
		seen[key] = true
		switch key {
		case "ok":
			err = decoder.Decode(&answer.OK)
		case "error":
			err = decoder.Decode(&answer.Error)
		case "result":
			err = decoder.Decode(&answer.Result)
		default:
			return answer, fmt.Errorf("unknown worker answer field: %s", key)
		}
		if err != nil {
			return answer, errors.New("invalid worker answer field")
		}
	}
	token, err = decoder.Token()
	if err != nil || token != json.Delim('}') || !seen["ok"] {
		return answer, errors.New("incomplete worker answer")
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return answer, errors.New("trailing worker answer data")
	}
	if answer.OK {
		if !seen["result"] || seen["error"] {
			return answer, errors.New("invalid successful worker answer")
		}
	} else if !seen["error"] || seen["result"] || answer.Error == "" {
		return answer, errors.New("invalid failed worker answer")
	}
	return answer, nil
}

// validateWorkerResultJSON rejects duplicate object keys at every depth before
// method-specific decoding. encoding/json otherwise silently keeps the last
// value, which makes an IPC result ambiguous to independent implementations.
func validateWorkerResultJSON(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := consumeWorkerJSONValue(decoder); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("trailing worker result data")
	}
	return nil
}

func consumeWorkerJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return errors.New("invalid worker result JSON")
	}
	delim, isDelim := token.(json.Delim)
	if !isDelim {
		return nil
	}
	switch delim {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return errors.New("invalid worker result object")
			}
			key, ok := keyToken.(string)
			if !ok {
				return errors.New("invalid worker result object key")
			}
			if _, exists := seen[key]; exists {
				return fmt.Errorf("duplicate worker result object key: %s", key)
			}
			seen[key] = struct{}{}
			if err := consumeWorkerJSONValue(decoder); err != nil {
				return err
			}
		}
		closing, err := decoder.Token()
		if err != nil || closing != json.Delim('}') {
			return errors.New("invalid worker result object boundary")
		}
	case '[':
		for decoder.More() {
			if err := consumeWorkerJSONValue(decoder); err != nil {
				return err
			}
		}
		closing, err := decoder.Token()
		if err != nil || closing != json.Delim(']') {
			return errors.New("invalid worker result array boundary")
		}
	default:
		return errors.New("invalid worker result JSON delimiter")
	}
	return nil
}

func (t *workerTransport) readLines() {
	scanner := bufio.NewScanner(t.output)
	// Scanner's token bound also needs room for the line delimiter and the
	// request-ID envelope. Enforce the body limit separately after decoding.
	scanner.Buffer(make([]byte, 4096), workerMaxFrameBytes+1)
	for scanner.Scan() {
		if len(scanner.Bytes()) > workerMaxFrameBytes {
			select {
			case t.lines <- workerLine{err: fmt.Errorf("worker response frame exceeds %d bytes", workerMaxFrameBytes)}:
			case <-t.done:
			}
			return
		}
		frame, err := decodeWorkerResponseFrame(scanner.Bytes())
		if err != nil {
			select {
			case t.lines <- workerLine{err: err}:
			case <-t.done:
			}
			return
		}
		if len(frame.Response) > workerMaxMessageBytes {
			select {
			case t.lines <- workerLine{err: fmt.Errorf("worker response exceeds %d bytes", workerMaxMessageBytes)}:
			case <-t.done:
			}
			return
		}
		line := append([]byte(nil), frame.Response...)
		select {
		case t.lines <- workerLine{value: line, id: frame.ID, readAt: time.Now()}:
		case <-t.done:
			return
		}
	}
	err := scanner.Err()
	if err == nil {
		err = io.EOF
	}
	select {
	case t.lines <- workerLine{err: err}:
	case <-t.done:
	}
}

func (t *workerTransport) fail(err error) error {
	if t.failed == nil {
		t.failed = err
	}
	t.stopOnce.Do(func() {
		close(t.done)
		_ = t.input.Close()
		_ = t.output.Close()
		if t.kill != nil {
			_ = t.kill()
		}
	})
	return t.failed
}

func (t *workerTransport) Call(payload []byte) ([]byte, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.failed != nil {
		return nil, t.failed
	}
	if len(payload) > workerMaxMessageBytes {
		return nil, fmt.Errorf("worker request exceeds %d bytes", workerMaxMessageBytes)
	}
	t.nextID++
	if t.nextID == 0 {
		return nil, t.fail(errors.New("worker request id exhausted"))
	}
	encoded, err := json.Marshal(workerRequestFrame{ID: t.nextID, Request: payload})
	if err != nil {
		return nil, fmt.Errorf("worker request frame encode failed: %w", err)
	}
	if len(encoded)+1 > workerMaxFrameBytes {
		return nil, fmt.Errorf("worker request frame exceeds %d bytes", workerMaxFrameBytes)
	}
	deadlineAt := time.Now().Add(t.timeout)
	deadline := time.NewTimer(time.Until(deadlineAt))
	defer deadline.Stop()
	type writeResult struct {
		n   int
		err error
	}
	written := make(chan writeResult, 1)
	frame := append(encoded, '\n')
	go func() {
		n, err := t.input.Write(frame)
		written <- writeResult{n: n, err: err}
	}()
	select {
	case result := <-written:
		if result.err != nil {
			return nil, t.fail(fmt.Errorf("worker request write failed: %w", result.err))
		}
		if result.n != len(frame) {
			return nil, t.fail(fmt.Errorf("worker request write failed: %w", io.ErrShortWrite))
		}
	case <-deadline.C:
		return nil, t.fail(errWorkerTimeout)
	}
	select {
	case line, ok := <-t.lines:
		if !ok {
			return nil, t.fail(errWorkerUnavailable)
		}
		if line.err != nil {
			return nil, t.fail(fmt.Errorf("%w: %v", errWorkerUnavailable, line.err))
		}
		if line.id != t.nextID {
			return nil, t.fail(fmt.Errorf("%w: response id mismatch (got %d, want %d)", errWorkerUnavailable, line.id, t.nextID))
		}
		if !line.readAt.Before(deadlineAt) {
			return nil, t.fail(errWorkerTimeout)
		}
		return line.value, nil
	case <-deadline.C:
		return nil, t.fail(errWorkerTimeout)
	}
}
