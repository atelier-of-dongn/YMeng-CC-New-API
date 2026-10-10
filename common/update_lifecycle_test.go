package common

import (
	"testing"
)

func resetUpdateLifecycleForTest() {
	updateLifecycle.activeRequests.Store(0)
	updateLifecycle.pendingWrites.Store(0)
	updateLifecycle.draining.Store(false)
	updateLifecycle.ready.Store(false)
}

func TestUpdateLifecycleWaitsForRequestsAndWrites(t *testing.T) {
	resetUpdateLifecycleForTest()
	t.Cleanup(resetUpdateLifecycleForTest)
	SetUpdateReady(true)
	if !BeginUpdateRequest() {
		t.Fatal("ready instance rejected a request")
	}
	BeginUpdateDrain()
	BeginUpdateWrite()
	status := UpdateLifecycle()
	if status.SafeToStop || status.ActiveRequests != 1 || status.PendingWrites != 1 {
		t.Fatalf("unexpected draining status: %+v", status)
	}
	EndUpdateRequest()
	EndUpdateWrite()
	status = UpdateLifecycle()
	if !status.SafeToStop {
		t.Fatalf("expected safe stop after all work completed: %+v", status)
	}
}

func TestUpdateLifecycleRejectsNewRequestsAfterDrain(t *testing.T) {
	resetUpdateLifecycleForTest()
	t.Cleanup(resetUpdateLifecycleForTest)
	SetUpdateReady(true)
	BeginUpdateDrain()
	if BeginUpdateRequest() {
		t.Fatal("draining instance accepted a new request")
	}
}
