package service

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// affiliateEligibleQuota 决定一笔消费中可计佣的额度。
// 退款/负额度不参与计佣，避免佣金被负向消费冲减出负数。
func affiliateEligibleQuota(quota int) int64 {
	if quota <= 0 {
		return 0
	}
	return int64(quota)
}

// isAffiliateBillableSource 判断该计费来源是否参与佣金结算。
// 只有钱包余额消费计佣：订阅按周期一次性付费，其额度消耗不代表新的付费流入，
// 若一并计佣会让邀请人对同一笔收入重复获得返佣。
func isAffiliateBillableSource(billingSource string) bool {
	return billingSource == BillingSourceWallet
}

// SettleAffiliateCommission 在一次计费完成后为邀请人结算佣金。
// 该函数不影响主计费结果：任何失败只记录日志，不向调用方返回错误。
func SettleAffiliateCommission(inviteeId int, sourceKey, billingSource, modelName string, quota int) {
	if !operation_setting.IsAffiliateEnabled() {
		return
	}
	eligible := affiliateEligibleQuota(quota)
	if eligible <= 0 {
		return
	}
	ratePercent := operation_setting.GetAffiliateCommissionRatePercent()
	if ratePercent <= 0 {
		return
	}
	if sourceKey == "" {
		return
	}
	if !isAffiliateBillableSource(billingSource) {
		return
	}

	inviterId, err := model.GetUserInviterId(inviteeId)
	if err != nil {
		common.SysError(fmt.Sprintf("affiliate: failed to load inviter of user %d: %s", inviteeId, err.Error()))
		return
	}
	if inviterId <= 0 || inviterId == inviteeId {
		return
	}

	record := &model.AffiliateCommission{
		InviterId:     int64(inviterId),
		InviteeId:     int64(inviteeId),
		SourceKey:     sourceKey,
		BillingSource: billingSource,
		ModelName:     modelName,
		ConsumedQuota: int64(quota),
		EligibleQuota: eligible,
		RatePercent:   int64(ratePercent),
	}
	if _, err := model.CreditAffiliateCommission(record); err != nil {
		common.SysError(fmt.Sprintf("affiliate: failed to settle commission for inviter %d: %s", inviterId, err.Error()))
	}
}

// SettleRelayAffiliateCommission 从 RelayInfo 提取结算所需上下文。
func SettleRelayAffiliateCommission(relayInfo *relaycommon.RelayInfo, quota int) {
	if relayInfo == nil {
		return
	}
	if relayInfo.IsPlayground {
		return
	}
	billingSource := relayInfo.BillingSource
	if billingSource == "" {
		billingSource = BillingSourceWallet
	}
	modelName := relayInfo.OriginModelName
	if modelName == "" {
		modelName = relayInfo.UpstreamModelName
	}
	SettleAffiliateCommission(relayInfo.UserId, relayInfo.RequestId, billingSource, modelName, quota)
}
