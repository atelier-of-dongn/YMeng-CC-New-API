package service

import (
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

const (
	upstreamBillingPerToken = "per_token"
	upstreamBillingPerCall  = "per_call"

	upstreamBasisInput   = "input"
	upstreamBasisOutput  = "output"
	upstreamBasisPerCall = "per_call"

	upstreamReferenceTokens = 1000
	// new-api reports an unlimited token's hard limit as exactly this amount.
	upstreamUnlimitedAmount = 100000000
)

type upstreamUsage struct {
	PromptTokens     int
	CompletionTokens int
	CacheTokens      int
}

// UpstreamInvertedModel is a model whose upstream cost reaches the lowest local
// selling price. Prices are USD per 1K tokens, or per call for per-call models.
type UpstreamInvertedModel struct {
	Model         string  `json:"model"`
	UpstreamModel string  `json:"upstream_model"`
	Basis         string  `json:"basis"`
	UpstreamUSD   float64 `json:"upstream_usd"`
	LocalUSD      float64 `json:"local_usd"`
}

type upstreamInversionInput struct {
	Models          []string
	ModelMapping    map[string]string
	LocalPricing    map[string]model.Pricing
	LocalGroupRatio float64
	UpstreamPricing map[string]model.Pricing
	UpstreamQPU     float64
	UpstreamRatio   float64
	CostFactor      float64
}

type upstreamInversionResult struct {
	Inverted []UpstreamInvertedModel
	Unknown  []string
	Mixed    []string
}

// pricingBaseUSD prices usage with one pricing entry before any group ratio.
// The local site and new-api upstreams share the model.Pricing shape, so the
// same conversion serves both sides.
func pricingBaseUSD(pricing model.Pricing, quotaPerUnit float64, usage upstreamUsage) (float64, string, bool) {
	if pricing.BillingMode == billing_setting.BillingModeTieredExpr && pricing.BillingExpr != "" {
		expr := pricing.BillingExpr
		// Task expressions price plugin usage facts, not tokens.
		if len(billingexpr.UsedUsageKeys(expr)) > 0 {
			return 0, "", false
		}
		params := BuildTieredTokenParams(&dto.Usage{
			PromptTokens:        usage.PromptTokens,
			CompletionTokens:    usage.CompletionTokens,
			PromptTokensDetails: dto.InputTokenDetails{CachedTokens: usage.CacheTokens},
		}, false, billingexpr.UsedVars(expr))
		output, _, err := billingexpr.RunExpr(expr, params)
		if err != nil || math.IsNaN(output) || math.IsInf(output, 0) || output < 0 {
			return 0, "", false
		}
		kind := upstreamBillingPerToken
		if billingexpr.UsesFixedPricing(expr) {
			kind = upstreamBillingPerCall
		}
		return output / 1_000_000, kind, true
	}
	if pricing.QuotaType == 1 {
		return pricing.ModelPrice, upstreamBillingPerCall, true
	}
	if quotaPerUnit <= 0 {
		return 0, "", false
	}
	cacheRatio := 1.0
	if pricing.CacheRatio != nil {
		cacheRatio = *pricing.CacheRatio
	}
	cacheTokens := float64(min(max(usage.CacheTokens, 0), usage.PromptTokens))
	tokens := float64(usage.PromptTokens) - cacheTokens + cacheTokens*cacheRatio +
		float64(usage.CompletionTokens)*pricing.CompletionRatio
	return tokens * pricing.ModelRatio / quotaPerUnit, upstreamBillingPerToken, true
}

// evaluateUpstreamInversion compares, per model, the upstream cost with the
// lowest local selling price using a 1K-token input and a 1K-token output
// reference request. Models priced per call on one side and per token on the
// other are reported as mixed instead of being compared.
func evaluateUpstreamInversion(input upstreamInversionInput) upstreamInversionResult {
	result := upstreamInversionResult{}
	references := []struct {
		basis string
		usage upstreamUsage
	}{
		{basis: upstreamBasisInput, usage: upstreamUsage{PromptTokens: upstreamReferenceTokens}},
		{basis: upstreamBasisOutput, usage: upstreamUsage{CompletionTokens: upstreamReferenceTokens}},
	}
	for _, name := range input.Models {
		upstreamName := name
		if mapped := input.ModelMapping[name]; mapped != "" {
			upstreamName = mapped
		}
		local, localOK := input.LocalPricing[name]
		upstream, upstreamOK := input.UpstreamPricing[upstreamName]
		if !localOK || !upstreamOK {
			result.Unknown = append(result.Unknown, name)
			continue
		}
		for _, reference := range references {
			localUSD, localKind, localPriced := pricingBaseUSD(local, common.QuotaPerUnit, reference.usage)
			upstreamUSD, upstreamKind, upstreamPriced := pricingBaseUSD(upstream, input.UpstreamQPU, reference.usage)
			if !localPriced || !upstreamPriced {
				result.Unknown = append(result.Unknown, name)
				break
			}
			if localKind != upstreamKind {
				result.Mixed = append(result.Mixed, name)
				break
			}
			localUSD *= input.LocalGroupRatio
			upstreamUSD *= input.UpstreamRatio * input.CostFactor
			basis := reference.basis
			if localKind == upstreamBillingPerCall {
				basis = upstreamBasisPerCall
			}
			// The relative tolerance keeps equal prices from flapping on float noise.
			if upstreamUSD > 0 && upstreamUSD >= localUSD*(1-1e-9) {
				result.Inverted = append(result.Inverted, UpstreamInvertedModel{
					Model:         name,
					UpstreamModel: upstreamName,
					Basis:         basis,
					UpstreamUSD:   upstreamUSD,
					LocalUSD:      localUSD,
				})
			}
			if localKind == upstreamBillingPerCall {
				break
			}
		}
	}
	return result
}

// lowestLocalGroupRatio is the cheapest group ratio any user may pay on the
// channel's groups, including user-group special ratios.
func lowestLocalGroupRatio(channelGroups []string, groupRatios map[string]float64, specialRatios map[string]map[string]float64) float64 {
	lowest := math.Inf(1)
	for _, group := range channelGroups {
		ratio, ok := groupRatios[group]
		if !ok {
			ratio = 1
		}
		lowest = min(lowest, ratio)
		for _, overrides := range specialRatios {
			if special, ok := overrides[group]; ok && special >= 0 {
				lowest = min(lowest, special)
			}
		}
	}
	if math.IsInf(lowest, 1) || lowest < 0 {
		return 1
	}
	return lowest
}

// estimateUpstreamCostQuota prices a local request with the upstream price list
// and returns the cost in local quota units including the site cost factor.
// Without upstream model pricing it scales the local charge by the ratio of the
// upstream and local group ratios.
func estimateUpstreamCostQuota(channel *upstreamCostChannelSnapshot, upstreamModel string, usage upstreamUsage, localQuota int, localGroupRatio float64, upstreamRatio float64) (int, bool) {
	if upstreamRatio <= 0 {
		return 0, false
	}
	if pricing, ok := channel.modelPricing[upstreamModel]; ok {
		if usd, _, priced := pricingBaseUSD(pricing, channel.site.QuotaPerUnit, usage); priced {
			return common.QuotaFromFloat(usd * upstreamRatio * common.QuotaPerUnit * channel.costFactor), true
		}
	}
	if localGroupRatio > 0 {
		return common.QuotaFromFloat(float64(localQuota) * upstreamRatio / localGroupRatio * channel.costFactor), true
	}
	return 0, false
}

// upstreamQuotaToLocal converts an upstream charge into local quota units and
// applies the site cost factor.
func upstreamQuotaToLocal(upstreamQuota int, upstreamQPU float64, costFactor float64) int {
	if upstreamQPU <= 0 {
		upstreamQPU = common.QuotaPerUnit
	}
	return common.QuotaFromFloat(float64(upstreamQuota) * common.QuotaPerUnit / upstreamQPU * costFactor)
}

// upstreamAmountUSD converts an OpenAI-compatible billing amount, which new-api
// reports in its display unit, back into USD.
func upstreamAmountUSD(amount float64, site *model.UpstreamSite) float64 {
	switch site.QuotaDisplayType {
	case operation_setting.QuotaDisplayTypeCNY:
		if site.USDExchangeRate > 0 {
			return amount / site.USDExchangeRate
		}
	case operation_setting.QuotaDisplayTypeTokens:
		if site.QuotaPerUnit > 0 {
			return amount / site.QuotaPerUnit
		}
	}
	return amount
}
