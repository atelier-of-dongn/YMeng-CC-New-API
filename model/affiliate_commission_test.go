package model

import (
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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
func setupAffiliateAnalyticsModelTest(t *testing.T, recordQueries bool) {
	t.Helper()
	originalDB := DB
	t.Cleanup(func() { DB = originalDB })
	var err error
	config := &gorm.Config{}
	if recordQueries {
		config.Logger = &migrationSQLRecorder{}
	}
	DB, err = gorm.Open(sqlite.Open(":memory:"), config)
	require.NoError(t, err)
	require.NoError(t, DB.AutoMigrate(&User{}, &AffiliateCommission{}))
}

func affiliateAnalyticsQueryRecorder(t *testing.T) *migrationSQLRecorder {
	t.Helper()
	recorder, ok := DB.Config.Logger.(*migrationSQLRecorder)
	require.True(t, ok)
	recorder.reset()
	return recorder
}

func affiliateAnalyticsSelectCount(recorder *migrationSQLRecorder) int {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	count := 0
	for _, statement := range recorder.statements {
		if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(statement)), "SELECT") {
			count++
		}
	}
	return count
}

func TestAffiliateAdminAnalyticsUsesAttributedUsersAndCompletedCommissions(t *testing.T) {
	setupAffiliateAnalyticsModelTest(t, false)
	const day = int64(86_400)
	start := int64(1_800_000_000 / 86_400 * 86_400)
	end := start + day - 1

	users := []User{
		{Id: 1, Username: "inviter-one", Password: "password", DisplayName: "Inviter One", AffCode: "code-one", CreatedAt: start - day},
		{Id: 2, Username: "inviter-two", Password: "password", DisplayName: "Inviter Two", AffCode: "code-two", CreatedAt: start - day},
		{Id: 3, Username: "invitee-a", Password: "password", DisplayName: "Invitee A", AffCode: "code-a", InviterId: 1, CreatedAt: start + 10},
		{Id: 4, Username: "invitee-b", Password: "password", DisplayName: "Invitee B", AffCode: "code-b", InviterId: 1, CreatedAt: start + day - 10},
		{Id: 5, Username: "invitee-c", Password: "password", DisplayName: "Invitee C", AffCode: "code-c", InviterId: 2, CreatedAt: end + 1},
	}
	require.NoError(t, DB.Create(&users).Error)

	commissions := []AffiliateCommission{
		{InviterId: 1, InviteeId: 3, SourceKey: "completed-a", ModelName: "model-a", BillingSource: "wallet", ConsumedQuota: 100, RatePercent: 5, RewardAmount: 5, CreditedQuota: 5, Status: AffiliateCommissionStatusCompleted, CreatedAt: start + 20},
		{InviterId: 1, InviteeId: 4, SourceKey: "completed-b", ModelName: "model-b", BillingSource: "wallet", ConsumedQuota: 200, RatePercent: 5, RewardAmount: 10, CreditedQuota: 10, Status: AffiliateCommissionStatusCompleted, CreatedAt: end - 10},
		{InviterId: 1, InviteeId: 3, SourceKey: "pending-a", Status: AffiliateCommissionStatusPending, CreatedAt: start + 30},
		{InviterId: 2, InviteeId: 5, SourceKey: "outside-range", Status: AffiliateCommissionStatusCompleted, CreditedQuota: 99, CreatedAt: end + 1},
	}
	require.NoError(t, DB.Create(&commissions).Error)

	overview, trend, err := GetAffiliateAdminAnalyticsOverview(start, end)
	require.NoError(t, err)
	assert.Equal(t, int64(2), overview.ReferralCount)
	assert.Equal(t, int64(1), overview.ActiveInviterCount)
	assert.Equal(t, int64(2), overview.CommissionCount)
	assert.Equal(t, int64(15), overview.CreditedQuota)
	require.Len(t, trend, 1)
	assert.Equal(t, time.Unix(start, 0).UTC().Format("2006-01-02"), trend[0].Date)
	assert.Equal(t, int64(2), trend[0].ReferralCount)
	assert.Equal(t, int64(2), trend[0].CommissionCount)
	assert.Equal(t, int64(15), trend[0].CreditedQuota)

	rankings, rankingTotal, err := GetAffiliateAdminAnalyticsRankings("inviter-one", start, end, 0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), rankingTotal)
	require.Len(t, rankings, 1)
	assert.Equal(t, int64(1), rankings[0].InviterId)
	assert.Equal(t, int64(2), rankings[0].ReferralCount)
	assert.Equal(t, int64(2), rankings[0].CommissionCount)
	assert.Equal(t, int64(15), rankings[0].CreditedQuota)

	rows, total, err := GetAffiliateAdminAnalyticsCommissions("invitee-a", AffiliateCommissionStatusCompleted, start, end, 0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, rows, 1)
	assert.Equal(t, "Inviter One", rows[0].InviterName)
	assert.Equal(t, "Invitee A", rows[0].InviteeName)
	assert.Equal(t, AffiliateCommissionStatusCompleted, rows[0].Status)

	rows, total, err = GetAffiliateAdminAnalyticsCommissions("", "", start, end, 1, 1)
	require.NoError(t, err)
	require.Equal(t, int64(3), total)
	require.Len(t, rows, 1)

	rows, total, err = GetAffiliateAdminAnalyticsCommissions("", "", start, end, 3, 1)
	require.NoError(t, err)
	require.Equal(t, int64(3), total)
	assert.NotNil(t, rows)
	assert.Empty(t, rows)
}

func TestAffiliateAdminAnalyticsDeduplicatesInvitersAcrossUTCDays(t *testing.T) {
	setupAffiliateAnalyticsModelTest(t, true)
	const day = int64(86_400)
	start := int64(1_800_000_000 / day * day)
	end := start + 2*day - 1

	users := []User{
		{Id: 1, Username: "inviter-one", Password: "password", AffCode: "code-one", CreatedAt: start - day},
		{Id: 2, Username: "inviter-two", Password: "password", AffCode: "code-two", CreatedAt: start - day},
		{Id: 3, Username: "invitee-a", Password: "password", AffCode: "code-a", InviterId: 1, CreatedAt: start + 10},
		{Id: 4, Username: "invitee-b", Password: "password", AffCode: "code-b", InviterId: 1, CreatedAt: start + day + 10},
		{Id: 5, Username: "invitee-c", Password: "password", AffCode: "code-c", InviterId: 2, CreatedAt: start + 20},
		{Id: 6, Username: "ordinary-user", Password: "password", AffCode: "code-d", CreatedAt: start + 30},
		{Id: 7, Username: "deleted-invitee", Password: "password", AffCode: "code-e", InviterId: 1, CreatedAt: start + 40, DeletedAt: gorm.DeletedAt{Valid: true, Time: time.Unix(start+50, 0)}},
	}
	require.NoError(t, DB.Create(&users).Error)
	commissions := []AffiliateCommission{
		{InviterId: 1, InviteeId: 3, SourceKey: "completed-a", CreditedQuota: 5, Status: AffiliateCommissionStatusCompleted, CreatedAt: start + 10},
		{InviterId: 1, InviteeId: 4, SourceKey: "completed-b", CreditedQuota: 10, Status: AffiliateCommissionStatusCompleted, CreatedAt: start + day + 10},
		{InviterId: 2, InviteeId: 5, SourceKey: "pending-a", CreditedQuota: 50, Status: AffiliateCommissionStatusPending, CreatedAt: start + 20},
	}
	require.NoError(t, DB.Create(&commissions).Error)

	recorder := affiliateAnalyticsQueryRecorder(t)
	overview, trend, err := GetAffiliateAdminAnalyticsOverview(start, end)
	require.NoError(t, err)
	assert.Equal(t, 2, affiliateAnalyticsSelectCount(recorder))
	assert.Equal(t, int64(3), overview.ReferralCount)
	assert.Equal(t, int64(2), overview.ActiveInviterCount)
	assert.Equal(t, int64(2), overview.CommissionCount)
	assert.Equal(t, int64(15), overview.CreditedQuota)
	require.Len(t, trend, 2)
	assert.Equal(t, int64(2), trend[0].ReferralCount)
	assert.Equal(t, int64(1), trend[1].ReferralCount)
	assert.Equal(t, int64(1), trend[0].CommissionCount)
	assert.Equal(t, int64(5), trend[0].CreditedQuota)
	assert.Equal(t, int64(1), trend[1].CommissionCount)
	assert.Equal(t, int64(10), trend[1].CreditedQuota)
}

func TestAffiliateAdminAnalyticsSkipsDetailQueriesForEmptyResults(t *testing.T) {
	setupAffiliateAnalyticsModelTest(t, true)
	const start = int64(1_800_000_000)
	end := start + 86_400

	recorder := affiliateAnalyticsQueryRecorder(t)
	rankings, rankingTotal, err := GetAffiliateAdminAnalyticsRankings("", start, end, 0, 10)
	require.NoError(t, err)
	assert.Zero(t, rankingTotal)
	assert.NotNil(t, rankings)
	assert.Empty(t, rankings)
	assert.Equal(t, 1, affiliateAnalyticsSelectCount(recorder))

	recorder.reset()
	rows, total, err := GetAffiliateAdminAnalyticsCommissions("", "", start, end, 0, 20)
	require.NoError(t, err)
	assert.Zero(t, total)
	assert.NotNil(t, rows)
	assert.Empty(t, rows)
	assert.Equal(t, 1, affiliateAnalyticsSelectCount(recorder))
}

// TestAffiliateAdminAnalyticsDatabaseMatrix requires disposable external databases.
func TestAffiliateAdminAnalyticsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "affiliate.db"))
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
				driver = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			previousDB := DB
			DB = db
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&AffiliateCommission{}, &User{}))
				DB = previousDB
				require.NoError(t, sqlDB.Close())
			})
			var version string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database: %s %s", dialect, version)
			require.NoError(t, db.AutoMigrate(&User{}, &AffiliateCommission{}))

			const day = int64(86_400)
			start := int64(1_800_000_000 / day * day)
			end := start + 2*day - 1
			users := []User{
				{Id: 1, Username: "inviter", Password: "password", AffCode: "inviter-code", CreatedAt: start - day},
				{Id: 2, Username: "invitee-a", Password: "password", AffCode: "invitee-code-a", InviterId: 1, CreatedAt: start + 10},
				{Id: 3, Username: "invitee-b", Password: "password", AffCode: "invitee-code-b", InviterId: 1, CreatedAt: start + day + 10},
			}
			require.NoError(t, db.Create(&users).Error)
			commissions := []AffiliateCommission{
				{InviterId: 1, InviteeId: 2, SourceKey: "completed-a", CreditedQuota: 5, Status: AffiliateCommissionStatusCompleted, CreatedAt: start + 10},
				{InviterId: 1, InviteeId: 3, SourceKey: "completed-b", CreditedQuota: 10, Status: AffiliateCommissionStatusCompleted, CreatedAt: start + day + 10},
			}
			require.NoError(t, db.Create(&commissions).Error)

			overview, trend, err := GetAffiliateAdminAnalyticsOverview(start, end)
			require.NoError(t, err)
			assert.Equal(t, int64(2), overview.ReferralCount)
			assert.Equal(t, int64(1), overview.ActiveInviterCount)
			assert.Equal(t, int64(2), overview.CommissionCount)
			assert.Equal(t, int64(15), overview.CreditedQuota)
			require.Len(t, trend, 2)
			assert.Equal(t, int64(1), trend[0].ReferralCount)
			assert.Equal(t, int64(1), trend[1].ReferralCount)

			rankings, total, err := GetAffiliateAdminAnalyticsRankings("", start, end, 0, 10)
			require.NoError(t, err)
			assert.Equal(t, int64(1), total)
			require.Len(t, rankings, 1)
			assert.Equal(t, int64(2), rankings[0].ReferralCount)
			rows, total, err := GetAffiliateAdminAnalyticsCommissions("", AffiliateCommissionStatusCompleted, start, end, 0, 10)
			require.NoError(t, err)
			assert.Equal(t, int64(2), total)
			require.Len(t, rows, 2)
		})
	}
}
