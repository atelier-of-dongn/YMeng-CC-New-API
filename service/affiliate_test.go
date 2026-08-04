package service

import "testing"

// TestAffiliateBillableSourceOnlyWallet 锁定"仅钱包消费计佣"的语义。
// 订阅额度消耗不产生新的付费流入，若计佣会导致同一笔收入被重复返佣。
func TestAffiliateBillableSourceOnlyWallet(t *testing.T) {
	cases := map[string]bool{
		BillingSourceWallet:       true,
		BillingSourceSubscription: false,
		"":                        false,
		"unknown":                 false,
	}
	for source, want := range cases {
		if got := isAffiliateBillableSource(source); got != want {
			t.Fatalf("isAffiliateBillableSource(%q) = %v, want %v", source, got, want)
		}
	}
}

func TestAffiliateEligibleQuotaIgnoresNonPositive(t *testing.T) {
	cases := map[int]int64{
		100:  100,
		1:    1,
		0:    0,
		-50:  0, // 退款不应冲减佣金
	}
	for quota, want := range cases {
		if got := affiliateEligibleQuota(quota); got != want {
			t.Fatalf("affiliateEligibleQuota(%d) = %d, want %d", quota, got, want)
		}
	}
}