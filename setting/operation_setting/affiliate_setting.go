package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// AffiliateSetting 推广佣金配置。
// 对应数据库 options 表中的 affiliate_setting.* 键。
type AffiliateSetting struct {
	Enabled              bool `json:"enabled"`                // 是否启用推广佣金
	CommissionRatePercent int `json:"commission_rate_percent"` // 佣金比例（百分比整数）
}

var affiliateSetting = AffiliateSetting{
	Enabled:               false,
	CommissionRatePercent: 5,
}

func init() {
	config.GlobalConfig.Register("affiliate_setting", &affiliateSetting)
}

func GetAffiliateSetting() *AffiliateSetting {
	return &affiliateSetting
}

func IsAffiliateEnabled() bool {
	return affiliateSetting.Enabled
}

// GetAffiliateCommissionRatePercent 返回受约束的佣金比例，避免异常配置放大结算金额。
func GetAffiliateCommissionRatePercent() int {
	rate := affiliateSetting.CommissionRatePercent
	if rate < 0 {
		return 0
	}
	if rate > 100 {
		return 100
	}
	return rate
}