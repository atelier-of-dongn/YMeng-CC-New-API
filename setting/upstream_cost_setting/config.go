package upstream_cost_setting

import (
	"time"

	"github.com/QuantumNous/new-api/setting/config"
)

type UpstreamCostSetting struct {
	Enabled              bool   `json:"enabled"`
	AutoDetect           bool   `json:"auto_detect"`
	LogPollSeconds       int    `json:"log_poll_seconds"`
	PricingMinutes       int    `json:"pricing_minutes"`
	RatioChangeHoldHours int    `json:"ratio_change_hold_hours"`
	RetentionDays        int    `json:"retention_days"`
	FeishuWebhookURL     string `json:"feishu_webhook_url"`
	FeishuSecret         string `json:"feishu_secret"`
}

var upstreamCostSetting = UpstreamCostSetting{
	Enabled:              false,
	AutoDetect:           true,
	LogPollSeconds:       60,
	PricingMinutes:       5,
	RatioChangeHoldHours: 24,
	RetentionDays:        30,
}

func init() {
	config.GlobalConfig.Register("upstream_cost_setting", &upstreamCostSetting)
}

func GetSetting() UpstreamCostSetting {
	return upstreamCostSetting
}

// LogPollInterval never drops below 30s: new-api upstreams share one
// 20-requests-per-20-minutes bucket across their token log endpoints.
func LogPollInterval() time.Duration {
	return time.Duration(max(upstreamCostSetting.LogPollSeconds, 30)) * time.Second
}

func PricingInterval() time.Duration {
	return time.Duration(max(upstreamCostSetting.PricingMinutes, 1)) * time.Minute
}

func RatioChangeHold() time.Duration {
	return time.Duration(max(upstreamCostSetting.RatioChangeHoldHours, 1)) * time.Hour
}
