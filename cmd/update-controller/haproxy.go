package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const maxHAProxyMapSize = 1 << 20

// persistHAProxyMap updates the configured map file using a same-directory
// temporary file and rename. The runtime socket remains the traffic switch;
// this file makes the selected backend survive an HAProxy restart.
func persistHAProxyMap(path, key, target string) error {
	if path == "" || key == "" || target == "" || strings.ContainsAny(path+key+target, "\r\n") {
		return fmt.Errorf("invalid HAProxy map persistence argument")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return fmt.Errorf("HAProxy map must be a regular non-symlink file")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(file, maxHAProxyMapSize+1))
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if len(data) > maxHAProxyMapSize {
		return fmt.Errorf("HAProxy map is too large")
	}
	updated, err := replaceHAProxyMapEntry(string(data), key, target)
	if err != nil {
		return err
	}
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".haproxy-map-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(info.Mode().Perm()); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.WriteString(updated); err != nil {
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
	return os.Rename(temporaryName, path)
}

func replaceHAProxyMapEntry(content, key, target string) (string, error) {
	lines := strings.Split(content, "\n")
	found := false
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) == 0 || fields[0] != key {
			continue
		}
		if found {
			return "", fmt.Errorf("HAProxy map contains duplicate key %q", key)
		}
		lines[index] = key + " " + target
		found = true
	}
	if found {
		return strings.Join(lines, "\n"), nil
	}
	if content != "" && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return content + key + " " + target + "\n", nil
}

func restoreHAProxyMap(ctx context.Context, u *controller) error {
	active, err := u.engine.Inspect(ctx, u.currentContainer())
	if err != nil {
		return err
	}
	if !active.State.Running {
		return fmt.Errorf("persisted active container is not running")
	}
	address, err := u.containerAddress(active)
	if err != nil {
		return err
	}
	lifecycle, err := u.lifecycle(ctx, address, "GET")
	if err != nil || lifecycle.Protocol != lifecycleProtocol || !lifecycle.Ready || lifecycle.Draining {
		return fmt.Errorf("persisted active container did not pass readiness")
	}
	target := address.host
	if err := persistHAProxyMap(u.config.haproxyMap, u.config.haproxyMapKey, target); err != nil {
		return err
	}
	return switchHAProxyMap(ctx, u.config.haproxySocket, u.config.haproxyMap, u.config.haproxyMapKey, target)
}
