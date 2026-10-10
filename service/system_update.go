package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/siteupdate"
)

func SystemUpdateRequest(ctx context.Context, method, endpoint string, payload any, result any) error {
	base := strings.TrimRight(os.Getenv("UPDATE_CONTROLLER_URL"), "/")
	token := os.Getenv("UPDATE_CONTROL_TOKEN")
	if base == "" || len(token) < 32 {
		return fmt.Errorf("managed update controller is not configured")
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return fmt.Errorf("invalid update controller configuration")
	}
	var data []byte
	if payload != nil {
		data, err = common.Marshal(payload)
		if err != nil {
			return err
		}
	}
	request, err := http.NewRequestWithContext(ctx, method, base+endpoint, bytes.NewReader(data))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("update controller is unavailable")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("cannot read update controller response")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("update controller rejected the operation (HTTP %d)", response.StatusCode)
	}
	return common.Unmarshal(body, result)
}

func SystemUpdateStatus(ctx context.Context) (siteupdate.Status, error) {
	status := siteupdate.Status{State: "unconfigured", Reason: "Connect the managed update controller before installing releases."}
	if os.Getenv("UPDATE_CONTROLLER_URL") == "" {
		return status, nil
	}
	err := SystemUpdateRequest(ctx, http.MethodGet, "/v1/status", nil, &status)
	return status, err
}
