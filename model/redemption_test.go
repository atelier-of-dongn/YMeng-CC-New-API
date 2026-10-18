package model

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
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
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&User{}).Error)
		require.NoError(t, LOG_DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Log{}).Error)
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

	// Redeeming the same code again must fail and must not credit quota.
	_, err = Redeem(key, userId)
	require.Error(t, err)
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)
}

func TestRedeemRejectsWalletOverflow(t *testing.T) {
	userId, key := setupRedeemFixture(t, 11)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).Update("quota", common.MaxWalletQuota-10).Error)

	_, err := Redeem(key, userId)
	require.ErrorIs(t, err, ErrRedeemFailed)

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, common.MaxWalletQuota-10, user.Quota)

	var redemption Redemption
	require.NoError(t, DB.First(&redemption, "key = ?", key).Error)
	assert.Equal(t, common.RedemptionCodeStatusEnabled, redemption.Status)
}

func TestRedemptionQuotaRejectsWalletOverflow(t *testing.T) {
	setupRedeemFixture(t, 500)

	redemption := &Redemption{
		Name:        "overflow-redemption",
		Key:         "10000000000000000000000000000002",
		Status:      common.RedemptionCodeStatusEnabled,
		Quota:       common.MaxWalletQuota + 1,
		CreatedTime: common.GetTimestamp(),
	}
	require.Error(t, redemption.Insert())
}

// TestCatFKDatabaseMatrix uses dedicated test databases when DSNs are supplied.
// The SQLite branch uses a real file, not a mocked SQL connection.
func TestCatFKDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "catfk.db"))
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "catfk_matrix_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			previousDB, previousLogDB := DB, LOG_DB
			previousMainType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
			DB, LOG_DB = db, db
			common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
			initCol()
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&CatFKOrder{}, &TopUp{}, &Redemption{}, &Log{}, &User{}))
				DB, LOG_DB = previousDB, previousLogDB
				common.SetDatabaseTypes(previousMainType, previousLogType)
				initCol()
				require.NoError(t, sqlDB.Close())
			})
			var version string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)
			// Simulate an existing pre-CatFK database before adding the detail table.
			require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}, &Redemption{}, &Log{}))
			legacy := &TopUp{UserId: 123, Amount: 2, Money: 2.5, TradeNo: "legacy-before-catfk", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending}
			require.NoError(t, db.Create(legacy).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(&CatFKOrder{}, &TopUp{}, &Redemption{}))
			}
			assert.Equal(t, int64(2), GetTopUpById(legacy.Id).Amount)
			t.Run("persistence", TestCatFKOrderPersistenceAndRecovery)
			t.Run("completion", TestCatFKCompletionIsAtomicAndIdempotent)
			t.Run("rollback", TestCatFKCompletionRollsBackFailures)
			t.Run("unique_and_concurrent", TestCatFKUniqueLinksAndConcurrentCompletion)
		})
	}
}

func setupCatFKOrderFixture(t *testing.T, userID int, suffix string) *CatFKOrder {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&CatFKOrder{}))
	order, existed, err := CreateCatFKOrder(&CatFKOrder{
		UserID: userID, TradeNo: "catfk-" + suffix, IdempotencyKey: "request-" + suffix,
		TierID: "tier", ProductID: "product", ChannelID: "channel", ExpectedQuota: 500,
		PriceAmount: "2.50", Currency: "CNY", ShopID: "shop", ShopName: "Snapshot shop", ShopURL: "https://example.com",
		CredentialCiphertext: "encrypted-credentials",
	})
	require.NoError(t, err)
	require.False(t, existed)
	t.Cleanup(func() {
		require.NoError(t, DB.Delete(&CatFKOrder{}, "id = ?", order.ID).Error)
		require.NoError(t, DB.Delete(&TopUp{}, "id = ?", order.TopUpID).Error)
	})
	return order
}

func markCatFKOrderPaid(t *testing.T, order *CatFKOrder) *CatFKOrder {
	t.Helper()
	claimed, ok, err := ClaimCatFKOrder(order.ID, common.GetTimestamp(), 60)
	require.NoError(t, err)
	require.True(t, ok)
	ok, err = MarkCatFKOrderCreated(order.ID, claimed.Version, fmt.Sprintf("upstream-%d", order.ID), "https://example.com/pay", common.GetTimestamp())
	require.NoError(t, err)
	require.True(t, ok)
	order, err = GetCatFKOrderByTradeNo(order.TradeNo)
	require.NoError(t, err)
	ok, err = UpdateCatFKOrder(order.ID, order.Version, CatFKOrderUpdate{Status: CatFKOrderStatusPaid, NextQueryAt: common.GetTimestamp()})
	require.NoError(t, err)
	require.True(t, ok)
	order, err = GetCatFKOrderByTradeNo(order.TradeNo)
	require.NoError(t, err)
	return order
}

func TestCatFKOrderPersistenceAndRecovery(t *testing.T) {
	userID, _ := setupRedeemFixture(t, 500)
	order := setupCatFKOrderFixture(t, userID, "recovery")
	assert.Equal(t, "encrypted-credentials", order.CredentialCiphertext)
	// Repeat migration with a representative existing row and verify it survives.
	require.NoError(t, DB.AutoMigrate(&CatFKOrder{}))
	require.NoError(t, DB.AutoMigrate(&CatFKOrder{}))
	existing, existed, err := CreateCatFKOrder(&CatFKOrder{UserID: userID, IdempotencyKey: order.IdempotencyKey})
	require.NoError(t, err)
	assert.True(t, existed)
	assert.Equal(t, order.ID, existing.ID)
	assert.Equal(t, 500, existing.ExpectedQuota)
	_, err = GetCatFKOrderForUser(userID+1, order.TradeNo)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
	payload, err := common.Marshal(order)
	require.NoError(t, err)
	assert.NotContains(t, string(payload), "encrypted-credentials")
	assert.NotContains(t, string(payload), "idempotency_key")
	now := common.GetTimestamp()
	claimed, ok, err := ClaimCatFKOrder(order.ID, now, 60)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, CatFKOrderStatusSubmitting, claimed.Status)
	_, ok, err = ClaimCatFKOrder(order.ID, now, 60)
	require.NoError(t, err)
	assert.False(t, ok)
	recovered, ok, err := ClaimCatFKOrder(order.ID, now+61, 60)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, CatFKOrderStatusCreationUnknown, recovered.Status)
	ok, err = MarkCatFKOrderCreated(order.ID, claimed.Version, "stale", "https://example.com/pay", now+62)
	require.NoError(t, err)
	assert.False(t, ok)
	ok, err = RetryCatFKOrder(order.ID, recovered.Version, now+120)
	require.NoError(t, err)
	require.True(t, ok)
	rows, err := ListDueCatFKOrders(now+119, 100)
	require.NoError(t, err)
	assert.Empty(t, rows)
	rows, err = ListDueCatFKOrders(now+120, 100)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, CatFKOrderStatusCreationUnknown, rows[0].Status)
	require.Error(t, ManualCompleteTopUp(order.TradeNo, ""))
	assert.Equal(t, common.TopUpStatusPending, GetTopUpById(order.TopUpID).Status)
}

func TestCatFKCompletionIsAtomicAndIdempotent(t *testing.T) {
	userID, key := setupRedeemFixture(t, 500)
	order := setupCatFKOrderFixture(t, userID, "complete")
	_, err := CompleteVerifiedCatFKOrder(order.ID, order.Version, key, "")
	require.ErrorIs(t, err, ErrCatFKOrderConflict)
	order = markCatFKOrderPaid(t, order)
	_, err = CompleteVerifiedCatFKOrder(order.ID, order.Version-1, key, "")
	require.ErrorIs(t, err, ErrCatFKOrderConflict)
	already, err := CompleteVerifiedCatFKOrder(order.ID, order.Version, key, "")
	require.NoError(t, err)
	assert.False(t, already)
	already, err = CompleteVerifiedCatFKOrder(order.ID, order.Version, "", "")
	require.NoError(t, err)
	assert.True(t, already)
	stored, err := GetCatFKOrderForUser(userID, order.TradeNo)
	require.NoError(t, err)
	assert.Equal(t, CatFKOrderStatusCompleted, stored.Status)
	assert.Empty(t, stored.CredentialCiphertext)
	require.NotNil(t, stored.RedemptionID)
	var redemption Redemption
	require.NoError(t, DB.First(&redemption, "id = ?", *stored.RedemptionID).Error)
	assert.Equal(t, userID, redemption.UsedUserId)
	assert.Equal(t, common.RedemptionCodeStatusUsed, redemption.Status)
	assert.Equal(t, common.TopUpStatusSuccess, GetTopUpById(order.TopUpID).Status)
	var user User
	require.NoError(t, DB.First(&user, "id = ?", userID).Error)
	assert.Equal(t, 500, user.Quota)
}

func TestCatFKCompletionRollsBackFailures(t *testing.T) {
	for _, scenario := range []string{"denomination", "expired", "disabled", "used", "wallet_overflow", "account_binding", "topup_conflict"} {
		t.Run(scenario, func(t *testing.T) {
			userID, key := setupRedeemFixture(t, 500)
			order := markCatFKOrderPaid(t, setupCatFKOrderFixture(t, userID, scenario))
			initialQuota := 0
			switch scenario {
			case "denomination":
				require.NoError(t, DB.Model(&Redemption{}).Where("key = ?", key).Update("quota", 501).Error)
			case "expired":
				require.NoError(t, DB.Model(&Redemption{}).Where("key = ?", key).Update("expired_time", common.GetTimestamp()-1).Error)
			case "disabled":
				require.NoError(t, DB.Model(&Redemption{}).Where("key = ?", key).Update("status", common.RedemptionCodeStatusDisabled).Error)
			case "used":
				require.NoError(t, DB.Model(&Redemption{}).Where("key = ?", key).Update("status", common.RedemptionCodeStatusUsed).Error)
			case "wallet_overflow":
				initialQuota = common.MaxWalletQuota - 499
				require.NoError(t, DB.Model(&User{}).Where("id = ?", userID).Update("quota", initialQuota).Error)
			case "account_binding":
				require.NoError(t, DB.Model(&TopUp{}).Where("id = ?", order.TopUpID).Update("user_id", userID+1).Error)
			case "topup_conflict":
				require.NoError(t, DB.Model(&TopUp{}).Where("id = ?", order.TopUpID).Update("status", common.TopUpStatusSuccess).Error)
			}
			var before Redemption
			require.NoError(t, DB.Where("key = ?", key).First(&before).Error)
			_, err := CompleteVerifiedCatFKOrder(order.ID, order.Version, key, "")
			require.Error(t, err)
			stored, err := GetCatFKOrderByTradeNo(order.TradeNo)
			require.NoError(t, err)
			assert.Equal(t, CatFKOrderStatusPaid, stored.Status)
			assert.Equal(t, order.Version, stored.Version)
			assert.Nil(t, stored.RedemptionID)
			assert.Equal(t, "encrypted-credentials", stored.CredentialCiphertext)
			var after Redemption
			require.NoError(t, DB.Where("key = ?", key).First(&after).Error)
			assert.Equal(t, before.Status, after.Status)
			assert.Equal(t, before.UsedUserId, after.UsedUserId)
			var user User
			require.NoError(t, DB.First(&user, "id = ?", userID).Error)
			assert.Equal(t, initialQuota, user.Quota)
		})
	}
}

func TestCatFKUniqueLinksAndConcurrentCompletion(t *testing.T) {
	userID, key := setupRedeemFixture(t, 500)
	first := markCatFKOrderPaid(t, setupCatFKOrderFixture(t, userID, "first"))
	second := setupCatFKOrderFixture(t, userID, "second")
	claimed, ok, err := ClaimCatFKOrder(second.ID, common.GetTimestamp(), 60)
	require.NoError(t, err)
	require.True(t, ok)
	_, err = MarkCatFKOrderCreated(second.ID, claimed.Version, *first.UpstreamOrderID, "https://example.com/pay", common.GetTimestamp())
	require.Error(t, err, "one upstream purchase must not fund two orders")
	// Separate shops may use the same upstream ID.
	require.NoError(t, DB.Model(&CatFKOrder{}).Where("id = ?", second.ID).Update("shop_id", "other-shop").Error)
	ok, err = MarkCatFKOrderCreated(second.ID, claimed.Version, *first.UpstreamOrderID, "https://example.com/pay", common.GetTimestamp())
	require.NoError(t, err)
	require.True(t, ok)
	var wg sync.WaitGroup
	results := make(chan bool, 2)
	for range 2 {
		wg.Go(func() {
			already, err := CompleteVerifiedCatFKOrder(first.ID, first.Version, key, "")
			results <- err == nil && !already
		})
	}
	wg.Wait()
	close(results)
	credits := 0
	for credited := range results {
		if credited {
			credits++
		}
	}
	assert.Equal(t, 1, credits)
	second, err = GetCatFKOrderByTradeNo(second.TradeNo)
	require.NoError(t, err)
	ok, err = UpdateCatFKOrder(second.ID, second.Version, CatFKOrderUpdate{Status: CatFKOrderStatusPaid})
	require.NoError(t, err)
	require.True(t, ok)
	second, err = GetCatFKOrderByTradeNo(second.TradeNo)
	require.NoError(t, err)
	_, err = CompleteVerifiedCatFKOrder(second.ID, second.Version, key, "")
	require.ErrorIs(t, err, ErrRedemptionUsed, "the same local code cannot fund another purchase")
	stored, err := GetCatFKOrderByTradeNo(second.TradeNo)
	require.NoError(t, err)
	assert.Equal(t, CatFKOrderStatusPaid, stored.Status)
	assert.Nil(t, stored.RedemptionID)
	assert.Equal(t, common.TopUpStatusPending, GetTopUpById(second.TopUpID).Status)
	completed, err := GetCatFKOrderByTradeNo(first.TradeNo)
	require.NoError(t, err)
	require.Error(t, DB.Model(&CatFKOrder{}).Where("id = ?", second.ID).Update("redemption_id", completed.RedemptionID).Error)
	var user User
	require.NoError(t, DB.First(&user, "id = ?", userID).Error)
	assert.Equal(t, 500, user.Quota)
}

// Exactly one of several concurrent redeems of the same code may win, and
// quota must be credited exactly once.
func TestRedeemConcurrentSingleSuccess(t *testing.T) {
	userId, key := setupRedeemFixture(t, 300)

	const goroutines = 5
	successes := make([]bool, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := range goroutines {
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
