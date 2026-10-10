package common

import (
	"sync/atomic"
)

// UpdateLifecycleSnapshot is the private control-plane state exposed to the
// managed updater. It deliberately contains no credentials or request data.
type UpdateLifecycleSnapshot struct {
	Protocol       int    `json:"protocol"`
	Ready          bool   `json:"ready"`
	Draining       bool   `json:"draining"`
	ActiveRequests int64  `json:"active_requests"`
	PendingWrites  int64  `json:"pending_writes"`
	SafeToStop     bool   `json:"safe_to_stop"`
	Reason         string `json:"reason"`
}

var updateLifecycle struct {
	activeRequests atomic.Int64
	pendingWrites  atomic.Int64
	draining       atomic.Bool
	ready          atomic.Bool
}

func BeginUpdateRequest() bool {
	if updateLifecycle.draining.Load() {
		return false
	}
	updateLifecycle.activeRequests.Add(1)
	if updateLifecycle.draining.Load() {
		updateLifecycle.activeRequests.Add(-1)
		return false
	}
	return true
}

func EndUpdateRequest() {
	updateLifecycle.activeRequests.Add(-1)
}

func BeginUpdateWrite() {
	updateLifecycle.pendingWrites.Add(1)
}

func EndUpdateWrite() {
	updateLifecycle.pendingWrites.Add(-1)
}

func SetUpdateReady(ready bool) {
	updateLifecycle.ready.Store(ready)
}

func BeginUpdateDrain() {
	updateLifecycle.draining.Store(true)
}

func UpdateLifecycle() UpdateLifecycleSnapshot {
	active := updateLifecycle.activeRequests.Load()
	pending := updateLifecycle.pendingWrites.Load()
	ready := updateLifecycle.ready.Load()
	draining := updateLifecycle.draining.Load()
	reason := "ready"
	if !ready {
		reason = "application is not ready"
	} else if !draining {
		reason = "accepting requests"
	} else if active != 0 {
		reason = "waiting for active requests and streams"
	} else if pending != 0 {
		reason = "waiting for pending billing writes"
	}
	return UpdateLifecycleSnapshot{
		Protocol:       1,
		Ready:          ready,
		Draining:       draining,
		ActiveRequests: active,
		PendingWrites:  pending,
		SafeToStop:     ready && draining && active == 0 && pending == 0,
		Reason:         reason,
	}
}
