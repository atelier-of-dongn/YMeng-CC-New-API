package model

import (
	"math"
	"testing"
)

// settleOnce 复刻 CreditAffiliateCommission 内的纯计算部分，
// 用于在不依赖数据库的情况下验证结算算法。
func settleOnce(eligibleQuota int64, ratePercent int64, remainderBefore float64) (credited int64, remainderAfter float64) {
	reward := float64(eligibleQuota) * float64(ratePercent) / 100
	reward = math.Round(reward*1e6) / 1e6
	total := math.Round((reward+remainderBefore)*1e6) / 1e6
	credited = int64(math.Floor(total))
	remainderAfter = math.Round((total-float64(credited))*1e6) / 1e6
	return credited, remainderAfter
}

// TestSettleMatchesProductionRows 使用生产库中的真实佣金记录校验算法。
// 每组数据取自 affiliate_commissions 表，确保重构后的结算结果与历史一致。
func TestSettleMatchesProductionRows(t *testing.T) {
	cases := []struct {
		name            string
		consumed        int64
		rate            int64
		remainderBefore float64
		wantCredited    int64
		wantRemainder   float64
	}{
		{"gpt-5.5 3619", 3619, 5, 0.90, 181, 0.85},
		{"gpt-5.6-terra 1131", 1131, 5, 0.60, 57, 0.15},
		{"gpt-5.5 3697", 3697, 5, 0.05, 184, 0.90},
		{"gpt-5.5 3936", 3936, 5, 0.25, 197, 0.05},
		{"gpt-5.6-terra 4187", 4187, 5, 0.25, 209, 0.60},
		{"gpt-5.6-luna 1154", 1154, 5, 0.55, 58, 0.25},
		{"gpt-5.5 31731", 31731, 5, 0.70, 1587, 0.25},
		{"gpt-5.6-sol 13136", 13136, 5, 0.75, 657, 0.55},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			credited, remainder := settleOnce(tc.consumed, tc.rate, tc.remainderBefore)
			if credited != tc.wantCredited {
				t.Fatalf("credited = %d, want %d", credited, tc.wantCredited)
			}
			if math.Abs(remainder-tc.wantRemainder) > 1e-9 {
				t.Fatalf("remainder = %v, want %v", remainder, tc.wantRemainder)
			}
		})
	}
}

// TestSettleConservesValue 验证尾数结转不会凭空产生或丢失额度。
func TestSettleConservesValue(t *testing.T) {
	remainder := 0.0
	var totalCredited int64
	const rate = 5
	consumptions := []int64{1, 7, 19, 33, 101, 999, 12345}

	var rewardSum float64
	for _, consumed := range consumptions {
		credited, next := settleOnce(consumed, rate, remainder)
		totalCredited += credited
		rewardSum += float64(consumed) * rate / 100
		remainder = next
	}

	// 累计入账 + 未结转尾数应等于累计应得佣金。
	got := float64(totalCredited) + remainder
	if math.Abs(got-rewardSum) > 1e-6 {
		t.Fatalf("credited+remainder = %v, want %v", got, rewardSum)
	}
	if remainder < 0 || remainder >= 1 {
		t.Fatalf("remainder out of range: %v", remainder)
	}
}

func TestSettleZeroRateCreditsNothing(t *testing.T) {
	credited, remainder := settleOnce(10000, 0, 0.4)
	if credited != 0 {
		t.Fatalf("credited = %d, want 0", credited)
	}
	if math.Abs(remainder-0.4) > 1e-9 {
		t.Fatalf("remainder = %v, want 0.4", remainder)
	}
}

func TestMaskAffiliateEmail(t *testing.T) {
	cases := map[string]string{
		"":                     "",
		"a@example.com":        "*@example.com",
		"abc@example.com":      "a**@example.com",
		"lakeside@example.com": "la****@example.com",
		"notanemail":           "***",
	}
	for input, want := range cases {
		if got := maskAffiliateEmail(input); got != want {
			t.Fatalf("maskAffiliateEmail(%q) = %q, want %q", input, got, want)
		}
	}
}