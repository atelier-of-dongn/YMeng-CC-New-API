package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/siteupdate"
)

type persistedState struct {
	Status            siteupdate.Status `json:"status"`
	ActiveContainer   string            `json:"active_container"`
	DrainingContainer string            `json:"draining_container"`
}

type stateStore struct {
	path string
}

func (s stateStore) load() (persistedState, error) {
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return persistedState{}, nil
	}
	if err != nil {
		return persistedState{}, err
	}
	var state persistedState
	if err := common.Unmarshal(data, &state); err != nil {
		return persistedState{}, fmt.Errorf("invalid update state: %w", err)
	}
	if state.ActiveContainer != "" && strings.ContainsAny(state.ActiveContainer, "\r\n") {
		return persistedState{}, fmt.Errorf("invalid active container in update state")
	}
	return state, nil
}

func (s stateStore) save(state persistedState) error {
	if s.path == "" {
		return fmt.Errorf("UPDATE_STATE_FILE is required")
	}
	data, err := common.Marshal(state)
	if err != nil {
		return err
	}
	directory := filepath.Dir(s.path)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".update-state-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryName, s.path); err != nil {
		return err
	}
	return nil
}
