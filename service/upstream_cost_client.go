package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

const (
	upstreamCostRequestTimeout   = 10 * time.Second
	upstreamCostSmallBodyLimit   = 1 << 20
	upstreamCostLogBodyLimit     = 8 << 20
	upstreamCostPricingBodyLimit = 16 << 20
	upstreamCostErrorMessageMax  = 200
)

// upstreamHTTPError keeps only what the monitor needs from a failed upstream
// call. It never carries request headers, so channel keys cannot leak into
// stored errors.
type upstreamHTTPError struct {
	StatusCode int
	Message    string
	RetryAfter time.Duration
}

func (e *upstreamHTTPError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("upstream returned status %d", e.StatusCode)
	}
	return fmt.Sprintf("upstream returned status %d: %s", e.StatusCode, e.Message)
}

type upstreamStatusData struct {
	Version           string  `json:"version"`
	SystemName        string  `json:"system_name"`
	QuotaPerUnit      float64 `json:"quota_per_unit"`
	QuotaDisplayType  *string `json:"quota_display_type"`
	DisplayInCurrency *bool   `json:"display_in_currency"`
	USDExchangeRate   float64 `json:"usd_exchange_rate"`
}

// isNewAPI recognizes new-api compatible upstreams from their public status.
func (s *upstreamStatusData) isNewAPI() bool {
	return s.Version != "" && s.QuotaPerUnit > 0 && (s.QuotaDisplayType != nil || s.DisplayInCurrency != nil)
}

// displayType falls back to display_in_currency for upstreams that predate
// quota_display_type.
func (s *upstreamStatusData) displayType() string {
	if s.QuotaDisplayType != nil && *s.QuotaDisplayType != "" {
		return *s.QuotaDisplayType
	}
	if s.DisplayInCurrency != nil && !*s.DisplayInCurrency {
		return "TOKENS"
	}
	return "USD"
}

type upstreamPricingResponse struct {
	Success     bool               `json:"success"`
	Message     string             `json:"message"`
	Data        []model.Pricing    `json:"data"`
	GroupRatio  map[string]float64 `json:"group_ratio"`
	UsableGroup map[string]string  `json:"usable_group"`
}

type upstreamLogEntry struct {
	CreatedAt int64  `json:"created_at"`
	Type      int    `json:"type"`
	ModelName string `json:"model_name"`
	Quota     int    `json:"quota"`
	Group     string `json:"group"`
	RequestId string `json:"request_id"`
	Other     string `json:"other"`
}

// ratios returns the group ratio the upstream charged and whether it came from
// an account-level special ratio (new-api logs user_group_ratio = -1 when
// none applies).
func (e *upstreamLogEntry) ratios() (float64, bool) {
	var other struct {
		GroupRatio     float64  `json:"group_ratio"`
		UserGroupRatio *float64 `json:"user_group_ratio"`
	}
	if e.Other == "" || common.UnmarshalJsonStr(e.Other, &other) != nil {
		return 0, false
	}
	return other.GroupRatio, other.UserGroupRatio != nil && *other.UserGroupRatio >= 0
}

type upstreamBalance struct {
	USD       float64
	Unlimited bool
}

func upstreamCostHTTPClient(channel *model.Channel) (*http.Client, error) {
	// Parse the setting directly: Channel.GetSetting rewrites the channel row on
	// invalid JSON, which must never happen on the partially loaded channels
	// used here.
	settings := dto.ChannelSettings{}
	if channel.Setting != nil && *channel.Setting != "" {
		_ = common.UnmarshalJsonStr(*channel.Setting, &settings)
	}
	return GetHttpClientWithProxySettings(settings.Proxy, settings)
}

// upstreamGet performs one bounded GET. The key is sent only as a Bearer token.
func upstreamGet(ctx context.Context, client *http.Client, rawURL string, key string, limit int64, out any) error {
	ctx, cancel := context.WithTimeout(ctx, upstreamCostRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := client.Do(req)
	if err != nil {
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			return fmt.Errorf("request upstream failed: %w", urlErr.Err)
		}
		return fmt.Errorf("request upstream failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return fmt.Errorf("read upstream response failed: %w", err)
	}
	if int64(len(body)) > limit {
		return errors.New("upstream response is too large")
	}
	if resp.StatusCode != http.StatusOK {
		httpErr := &upstreamHTTPError{
			StatusCode: resp.StatusCode,
			Message:    upstreamErrorMessage(body),
		}
		if seconds, err := strconv.Atoi(strings.TrimSpace(resp.Header.Get("Retry-After"))); err == nil && seconds > 0 {
			httpErr.RetryAfter = time.Duration(seconds) * time.Second
		}
		return httpErr
	}
	if err := common.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode upstream response failed: %w", err)
	}
	return nil
}

// upstreamErrorMessage extracts the message of new-api management and relay
// error bodies, trimmed for storage.
func upstreamErrorMessage(body []byte) string {
	var payload struct {
		Message string `json:"message"`
		Error   *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := common.Unmarshal(body, &payload); err != nil {
		return ""
	}
	message := payload.Message
	if payload.Error != nil && payload.Error.Message != "" {
		message = payload.Error.Message
	}
	return truncateUpstreamError(message)
}

func truncateUpstreamError(message string) string {
	return truncateRunes(strings.TrimSpace(message), upstreamCostErrorMessageMax)
}

func upstreamErrorStatus(err error) int {
	var httpErr *upstreamHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.StatusCode
	}
	return 0
}

func fetchUpstreamStatus(ctx context.Context, client *http.Client, baseURL string) (*upstreamStatusData, error) {
	var response struct {
		Success bool               `json:"success"`
		Message string             `json:"message"`
		Data    upstreamStatusData `json:"data"`
	}
	if err := upstreamGet(ctx, client, baseURL+"/api/status", "", upstreamCostSmallBodyLimit, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("upstream status failed: %s", truncateUpstreamError(response.Message))
	}
	return &response.Data, nil
}

// fetchUpstreamPricing reads the public pricing page anonymously; sending a
// channel key would not unlock more groups.
func fetchUpstreamPricing(ctx context.Context, client *http.Client, baseURL string) (*upstreamPricingResponse, error) {
	response := &upstreamPricingResponse{}
	if err := upstreamGet(ctx, client, baseURL+"/api/pricing", "", upstreamCostPricingBodyLimit, response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, &upstreamHTTPError{StatusCode: http.StatusForbidden, Message: truncateUpstreamError(response.Message)}
	}
	return response, nil
}

// fetchUpstreamUserGroups reads the anonymous group list, the fallback source
// of group ratios when the upstream pricing page is disabled.
func fetchUpstreamUserGroups(ctx context.Context, client *http.Client, baseURL string) (map[string]upstreamGroupState, error) {
	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    map[string]struct {
			Ratio any    `json:"ratio"`
			Desc  string `json:"desc"`
		} `json:"data"`
	}
	if err := upstreamGet(ctx, client, baseURL+"/api/user/groups", "", upstreamCostSmallBodyLimit, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("upstream groups failed: %s", truncateUpstreamError(response.Message))
	}
	groups := make(map[string]upstreamGroupState, len(response.Data))
	for name, group := range response.Data {
		// The auto group reports a label instead of a numeric ratio.
		ratio, ok := group.Ratio.(float64)
		if !ok {
			continue
		}
		groups[name] = upstreamGroupState{Ratio: ratio, Desc: group.Desc}
	}
	return groups, nil
}

func fetchUpstreamTokenLogs(ctx context.Context, client *http.Client, baseURL string, key string) ([]upstreamLogEntry, error) {
	var response struct {
		Success bool               `json:"success"`
		Message string             `json:"message"`
		Data    []upstreamLogEntry `json:"data"`
	}
	if err := upstreamGet(ctx, client, baseURL+"/api/log/token", key, upstreamCostLogBodyLimit, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("upstream token logs failed: %s", truncateUpstreamError(response.Message))
	}
	return response.Data, nil
}

// fetchUpstreamBalance reads a key's remaining balance through the
// OpenAI-compatible dashboard endpoints and converts it to USD.
func fetchUpstreamBalance(ctx context.Context, client *http.Client, site *model.UpstreamSite, key string) (upstreamBalance, error) {
	var subscription struct {
		HardLimitUSD float64 `json:"hard_limit_usd"`
	}
	if err := upstreamGet(ctx, client, site.BaseURL+"/v1/dashboard/billing/subscription", key, upstreamCostSmallBodyLimit, &subscription); err != nil {
		return upstreamBalance{}, err
	}
	if subscription.HardLimitUSD == upstreamUnlimitedAmount {
		return upstreamBalance{Unlimited: true}, nil
	}
	var usage struct {
		TotalUsage float64 `json:"total_usage"`
	}
	if err := upstreamGet(ctx, client, site.BaseURL+"/v1/dashboard/billing/usage", key, upstreamCostSmallBodyLimit, &usage); err != nil {
		return upstreamBalance{}, err
	}
	return upstreamBalance{USD: upstreamAmountUSD(subscription.HardLimitUSD-usage.TotalUsage/100, site)}, nil
}
