//go:build linux

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

const (
	quotaHaltWriteRetryInitial = time.Second
	quotaHaltWriteRetryMax     = 30 * time.Second
	quotaHaltWriteLogInterval  = 30 * time.Second
)

func nextQuotaHaltWriteRetry(current time.Duration) time.Duration {
	if current < quotaHaltWriteRetryInitial {
		return quotaHaltWriteRetryInitial
	}
	if current >= quotaHaltWriteRetryMax/2 {
		return quotaHaltWriteRetryMax
	}
	return current * 2
}

func shouldLogQuotaHaltWriteFailure(now, lastLogged time.Time) bool {
	return lastLogged.IsZero() || now.Sub(lastLogged) >= quotaHaltWriteLogInterval
}

type quotaHaltEvidenceOps struct {
	createTemp func(string, string) (*os.File, error)
	write      func(*os.File, []byte) (int, error)
	syncFile   func(*os.File) error
	link       func(string, string) error
	syncDir    func(string) error
	readFile   func(string) ([]byte, error)
	lstat      func(string) (os.FileInfo, error)
}

func defaultQuotaHaltEvidenceOps() quotaHaltEvidenceOps {
	return quotaHaltEvidenceOps{
		createTemp: os.CreateTemp,
		write:      (*os.File).Write,
		syncFile:   (*os.File).Sync,
		link:       os.Link,
		syncDir: func(path string) error {
			dir, err := os.Open(path)
			if err != nil {
				return err
			}
			defer dir.Close()
			return dir.Sync()
		},
		readFile: os.ReadFile,
		lstat:    os.Lstat,
	}
}

// writeExclusiveJSON publishes a complete, synced record atomically. The hard
// link provides exclusive publication without replacing an existing record.
func writeExclusiveJSON(path string, value interface{}) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return writeExclusiveBytes(path, append(encoded, '\n'), defaultQuotaHaltEvidenceOps())
}

func writeExclusiveBytes(path string, encoded []byte, ops quotaHaltEvidenceOps) error {
	dir := filepath.Dir(path)
	temp, err := ops.createTemp(dir, ".quota-halt-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer func() {
		_ = temp.Close()
		_ = os.Remove(tempPath)
	}()

	if err := temp.Chmod(0600); err != nil {
		return err
	}
	written, err := ops.write(temp, encoded)
	if err != nil {
		return err
	}
	if written != len(encoded) {
		return io.ErrShortWrite
	}
	if err := ops.syncFile(temp); err != nil {
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}

	if err := ops.link(tempPath, path); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return err
		}
		// A prior attempt can have linked the complete record but lost its
		// directory-sync acknowledgement. Accept only byte-identical regular
		// files, then retry the directory sync before acknowledging durability.
		info, statErr := ops.lstat(path)
		if statErr != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("existing halt evidence is not a regular file: %w", err)
		}
		current, readErr := ops.readFile(path)
		if readErr != nil || string(current) != string(encoded) {
			return fmt.Errorf("existing halt evidence differs from this commit: %w", err)
		}
	}
	if err := ops.syncDir(dir); err != nil {
		return err
	}
	return nil
}
