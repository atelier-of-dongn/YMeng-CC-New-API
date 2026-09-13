package model

import (
	"strconv"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSearchRedemptionsFiltersAndPaginates(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	})

	now := common.GetTimestamp()
	redemptions := []Redemption{
		{Id: 1, Name: "alpha-active", Key: "00000000000000000000000000000001", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: 0},
		{Id: 2, Name: "alpha-future", Key: "00000000000000000000000000000002", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now + 3600},
		{Id: 3, Name: "alpha-expired", Key: "00000000000000000000000000000003", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now - 10},
		{Id: 4, Name: "beta-disabled", Key: "00000000000000000000000000000004", Status: common.RedemptionCodeStatusDisabled, ExpiredTime: 0},
		{Id: 5, Name: "beta-used", Key: "00000000000000000000000000000005", Status: common.RedemptionCodeStatusUsed, ExpiredTime: 0},
	}
	require.NoError(t, DB.Create(&redemptions).Error)

	tests := []struct {
		name      string
		keyword   string
		status    string
		startIdx  int
		num       int
		wantTotal int64
		wantIds   []int
	}{
		{
			name:      "no filters returns all rows",
			num:       10,
			wantTotal: 5,
			wantIds:   []int{5, 4, 3, 2, 1},
		},
		{
			name:      "keyword filters by name prefix",
			keyword:   "alpha",
			num:       10,
			wantTotal: 3,
			wantIds:   []int{3, 2, 1},
		},
		{
			name:      "enabled status excludes expired rows",
			status:    "1",
			num:       10,
			wantTotal: 2,
			wantIds:   []int{2, 1},
		},
		{
			name:      "expired status returns enabled expired rows",
			status:    "expired",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{3},
		},
		{
			name:      "disabled status",
			status:    "2",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{4},
		},
		{
			name:      "used status",
			status:    "3",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{5},
		},
		{
			name:      "pagination keeps unpaged total",
			startIdx:  1,
			num:       2,
			wantTotal: 5,
			wantIds:   []int{4, 3},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rows, total, err := SearchRedemptions(tt.keyword, tt.status, tt.startIdx, tt.num)
			require.NoError(t, err)
			assert.Equal(t, tt.wantTotal, total)
			gotIds := make([]int, 0, len(rows))
			for _, row := range rows {
				gotIds = append(gotIds, row.Id)
			}
			assert.Equal(t, tt.wantIds, gotIds)
		})
	}
}

func setupRedeemFixture(t *testing.T, quota int) (userId int, key string) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM logs")
		DB.Exec("DELETE FROM top_ups")
	})

	user := &User{Username: "redeem-user", Password: "password", Status: common.UserStatusEnabled, Quota: 0}
	require.NoError(t, DB.Create(user).Error)

	key = "10000000000000000000000000000001"
	redemption := &Redemption{
		Name:        "redeem-test",
		Key:         key,
		Status:      common.RedemptionCodeStatusEnabled,
		Quota:       quota,
		CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(redemption).Error)
	return user.Id, key
}

func TestRedeemCreditsQuotaExactlyOnce(t *testing.T) {
	userId, key := setupRedeemFixture(t, 500)

	quota, err := Redeem(key, userId)
	require.NoError(t, err)
	assert.Equal(t, 500, quota)

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)

	var redemption Redemption
	require.NoError(t, DB.First(&redemption, "name = ?", "redeem-test").Error)
	assert.Equal(t, common.RedemptionCodeStatusUsed, redemption.Status)
	assert.Equal(t, userId, redemption.UsedUserId)

	var topUp TopUp
	require.NoError(t, DB.Where("trade_no = ?", "redemption:"+strconv.Itoa(redemption.Id)).First(&topUp).Error)
	assert.Equal(t, PaymentProviderRedemption, topUp.PaymentProvider)
	assert.Equal(t, common.TopUpStatusSuccess, topUp.Status)
	assert.Equal(t, int64(500), topUp.CreditedQuota)
	wantInvoiceAmount, invoiceErr := InvoiceAmountFromQuota(500)
	require.NoError(t, invoiceErr)
	assert.Equal(t, wantInvoiceAmount, topUp.InvoiceAmount)

	// Redeeming the same code again must fail and must not credit quota.
	_, err = Redeem(key, userId)
	require.Error(t, err)
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)
}

func TestBackfillRedemptionInvoiceTopUpsIncludesDeletedHistoryAndIsIdempotent(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	})
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 100
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })

	user := &User{Username: "redeem-history", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(user).Error)
	redemption := &Redemption{
		UserId:       user.Id,
		UsedUserId:   user.Id,
		Name:         "historical-code",
		Key:          "20000000000000000000000000000001",
		Status:       common.RedemptionCodeStatusUsed,
		Quota:        60_000,
		CreatedTime:  100,
		RedeemedTime: 200,
	}
	require.NoError(t, DB.Create(redemption).Error)
	require.NoError(t, DB.Delete(redemption).Error)

	require.NoError(t, BackfillRedemptionInvoiceTopUps())
	require.NoError(t, BackfillRedemptionInvoiceTopUps())

	var topUps []TopUp
	require.NoError(t, DB.Where("trade_no = ?", "redemption:"+strconv.Itoa(redemption.Id)).Find(&topUps).Error)
	require.Len(t, topUps, 1)
	assert.Equal(t, user.Id, topUps[0].UserId)
	assert.Equal(t, int64(60_000), topUps[0].CreditedQuota)
	assert.Equal(t, int64(600*InvoiceAmountScale), topUps[0].InvoiceAmount)
	assert.Equal(t, int64(200), topUps[0].CompleteTime)
	billingRows, billingTotal, err := GetAllTopUps(&common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Zero(t, billingTotal)
	assert.Empty(t, billingRows)

	eligibility, err := GetInvoiceEligibility(user.Id)
	require.NoError(t, err)
	require.Len(t, eligibility.Orders, 1)
	assert.Equal(t, topUps[0].Id, eligibility.Orders[0].Id)

	application, err := CreateInvoiceApplication(user.Id, "Example Company", "91350000TEST", []int{topUps[0].Id})
	require.NoError(t, err)
	assert.Equal(t, int64(600*InvoiceAmountScale), application.NetAmount)
}

func TestRedeemStillCreditsQuotaWhenInvoiceConversionIsTemporarilyUnavailable(t *testing.T) {
	userId, key := setupRedeemFixture(t, 500)
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 0
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })

	quota, err := Redeem(key, userId)
	require.NoError(t, err)
	assert.Equal(t, 500, quota)

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)

	var count int64
	require.NoError(t, DB.Model(&TopUp{}).Where("payment_provider = ?", PaymentProviderRedemption).Count(&count).Error)
	assert.Zero(t, count)

	common.QuotaPerUnit = 100
	require.NoError(t, BackfillRedemptionInvoiceTopUps())
	require.NoError(t, DB.Model(&TopUp{}).Where("payment_provider = ?", PaymentProviderRedemption).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

// Exactly one of several concurrent redeems of the same code may win, and
// quota must be credited exactly once.
func TestRedeemConcurrentSingleSuccess(t *testing.T) {
	userId, key := setupRedeemFixture(t, 300)

	const goroutines = 5
	successes := make([]bool, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			if _, err := Redeem(key, userId); err == nil {
				successes[idx] = true
			}
		}(i)
	}
	wg.Wait()

	successCount := 0
	for _, ok := range successes {
		if ok {
			successCount++
		}
	}
	assert.Equal(t, 1, successCount, "exactly one concurrent redeem should succeed")

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 300, user.Quota, "quota must be credited exactly once")
}
