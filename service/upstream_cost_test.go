package service

import (
	"context"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/upstream_cost_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupUpstreamCostTables(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.UpstreamSite{}, &model.UpstreamChannelMonitor{}, &model.UpstreamCostRecord{}, &model.AffiliateCommission{}))
	resetTables := func() {
		model.DB.Exec("DELETE FROM affiliate_commissions")
		model.DB.Exec("DELETE FROM upstream_cost_records")
		model.DB.Exec("DELETE FROM upstream_channel_monitors")
		model.DB.Exec("DELETE FROM upstream_sites")
		model.DB.Exec("DELETE FROM channels")
	}
	resetTables()
	t.Cleanup(resetTables)
}

func floatPtr(value float64) *float64 {
	return &value
}

func TestAffiliateUpstreamCostDatabaseMatrix(t *testing.T) {
	for _, dialect := range []struct {
		name common.DatabaseType
		env  string
	}{
		{common.DatabaseTypeSQLite, ""},
		{common.DatabaseTypeMySQL, "TEST_FIXED_MYSQL_DSN"},
		{common.DatabaseTypePostgreSQL, "TEST_FIXED_POSTGRES_DSN"},
	} {
		t.Run(string(dialect.name), func(t *testing.T) {
			var driver gorm.Dialector = sqlite.Open(":memory:")
			if dialect.env != "" {
				dsn := os.Getenv(dialect.env)
				if dsn == "" {
					t.Skip(dialect.env + " is not configured; use isolated test databases")
				}
				if dialect.name == common.DatabaseTypeMySQL {
					driver = mysql.Open(dsn)
				} else {
					driver = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
				}
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			// A separate log DB has neither ledger nor mirror tables.
			logDB, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			require.NoError(t, err)
			logSQL, err := logDB.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, logSQL.Close()) })
			oldDB, oldLogDB := model.DB, model.LOG_DB
			oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
			model.DB, model.LOG_DB = db, logDB
			common.SetDatabaseTypes(dialect.name, common.DatabaseTypeSQLite)
			t.Cleanup(func() {
				model.DB, model.LOG_DB = oldDB, oldLogDB
				common.SetDatabaseTypes(oldMain, oldLog)
			})
			require.NoError(t, db.AutoMigrate(&model.UpstreamCostRecord{}, &model.AffiliateCommission{}))
			versionQuery := "SELECT version()"
			if dialect.name == common.DatabaseTypeSQLite {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database: %s", version)
			t.Run("attribution", testAffiliateCostAttribution)
			t.Run("ambiguity", testAffiliateCostAmbiguity)
			t.Run("failures", testAffiliateCostReadFailures)
		})
	}
}

func testAffiliateCostAttribution(t *testing.T) {
	t.Cleanup(func() {
		model.DB.Exec("DELETE FROM affiliate_commissions")
		model.DB.Exec("DELETE FROM upstream_cost_records")
	})
	records := []*model.UpstreamCostRecord{
		{RequestId: "shared", UserId: 2, ModelName: "a", Quota: 100, CreatedAt: 100, Username: "alice", TokenName: "token", ChannelId: 1, UsingGroup: "vip", CostQuota: 30, Status: model.UpstreamCostRecordMatched},
		{RequestId: "shared", UserId: 3, ModelName: "a", Quota: 100, ChannelId: 2, CostQuota: 20, Status: model.UpstreamCostRecordEstimated},
		{RequestId: "shared", UserId: 2, ModelName: "b", Quota: 100, Status: model.UpstreamCostRecordUnknown},
		{RequestId: "shared", UserId: 2, ModelName: "a", Quota: 50, CreatedAt: 200, ChannelId: 1, CostQuota: 10, Status: model.UpstreamCostRecordMatched},
		{RequestId: "internal", UserId: 1, ModelName: "a", Quota: 80, CostQuota: 40, Status: model.UpstreamCostRecordEstimated},
	}
	require.NoError(t, model.InsertUpstreamCostRecords(records))
	logs := make([]*model.Log, 0, len(records)+3)
	for i, r := range records {
		require.NoError(t, model.DB.Create(&model.AffiliateCommission{InviterId: int64(10 + i), SourceKey: r.RequestId, InviteeId: int64(r.UserId), ModelName: r.ModelName, ConsumedQuota: int64(r.Quota), RewardAmount: float64(i) + 0.123456, CreditedQuota: 99, Status: model.AffiliateCommissionStatusCompleted, CreatedAt: 90000}).Error)
		logs = append(logs, &model.Log{Type: model.LogTypeConsume, RequestId: r.RequestId, UserId: r.UserId, ModelName: r.ModelName, Quota: r.Quota, ChannelId: r.ChannelId, CreatedAt: r.CreatedAt})
	}
	for i, status := range []string{model.AffiliateCommissionStatusPending, model.AffiliateCommissionStatusFailed} {
		require.NoError(t, model.DB.Create(&model.AffiliateCommission{InviterId: int64(20 + i), SourceKey: "shared", InviteeId: 2, ModelName: "a", ConsumedQuota: 100, RewardAmount: 99, Status: status}).Error)
	}
	require.NoError(t, model.DB.Create(&model.AffiliateCommission{InviterId: 10, SourceKey: "unmonitored", InviteeId: 2, ModelName: "a", ConsumedQuota: 20, RewardAmount: 6, Status: model.AffiliateCommissionStatusCompleted}).Error)
	logs = append(logs,
		&model.Log{Type: model.LogTypeConsume, RequestId: "unmonitored", UserId: 2, ModelName: "a", Quota: 20},
		&model.Log{Type: model.LogTypeConsume, RequestId: "no-reward"},
		&model.Log{Type: model.LogTypeError, RequestId: "shared"},
		&model.Log{Type: model.LogTypeConsume, RequestId: "internal", UserId: 99, ModelName: "a", Quota: 80})
	items := AttachUpstreamCostToLogs(logs)
	for i := range records {
		require.NotNil(t, items[i].AffiliateCost)
		assert.InDelta(t, float64(i)+0.123456, *items[i].AffiliateCost, 1e-9)
	}
	require.NotNil(t, items[5].AffiliateCost)
	assert.Equal(t, float64(6), *items[5].AffiliateCost)
	assert.Nil(t, items[5].UpstreamCost)
	require.NotNil(t, items[6].AffiliateCost)
	assert.Zero(t, *items[6].AffiliateCost)
	assert.Nil(t, items[7].AffiliateCost)
	assert.Nil(t, items[8].UpstreamCost, "single candidate still requires user matching")
	encoded, err := common.Marshal(items[7])
	require.NoError(t, err)
	assert.Contains(t, string(encoded), `"affiliate_cost":null`)
	stat, err := model.SumUpstreamCost(model.LogFilter{StartTimestamp: 90, EndTimestamp: 110, ModelName: "a", Username: "al%", TokenName: "token", Channel: 1, Group: "vip"}, false)
	require.NoError(t, err)
	assert.InDelta(t, 0.123456, stat.AffiliateCost, 1e-9, "use consumption date, not settlement date")
	assert.Equal(t, int64(100), stat.Revenue)
	stat, err = model.SumUpstreamCost(model.LogFilter{}, true)
	require.NoError(t, err)
	assert.InDelta(t, 8.493824, stat.AffiliateCost, 1e-9, "exclude unknown upstream costs and unmonitored consumption")
	assert.Equal(t, int64(250), stat.Revenue)
	assert.Equal(t, int64(100), stat.Cost)
	stat, err = model.SumUpstreamCost(model.LogFilter{StartTimestamp: 150, EndTimestamp: 250, ModelName: "a", Channel: 1}, false)
	require.NoError(t, err)
	assert.InDelta(t, 3.123456, stat.AffiliateCost, 1e-9)
}

func testAffiliateCostAmbiguity(t *testing.T) {
	t.Cleanup(func() {
		model.DB.Exec("DELETE FROM affiliate_commissions")
		model.DB.Exec("DELETE FROM upstream_cost_records")
	})
	require.NoError(t, model.InsertUpstreamCostRecords([]*model.UpstreamCostRecord{
		{RequestId: "duplicate", UserId: 2, ModelName: "a", Quota: 100, ChannelId: 1, CreatedAt: 100, Status: model.UpstreamCostRecordMatched},
		{RequestId: "duplicate", UserId: 2, ModelName: "a", Quota: 100, ChannelId: 2, CreatedAt: 200, Status: model.UpstreamCostRecordUnknown},
	}))
	log := &model.Log{Type: model.LogTypeConsume, RequestId: "duplicate", UserId: 2, ModelName: "a", Quota: 100, ChannelId: 1, CreatedAt: 100}
	for _, status := range []string{"", model.AffiliateCommissionStatusPending, model.AffiliateCommissionStatusCompleted} {
		require.NoError(t, model.DB.Exec("DELETE FROM affiliate_commissions").Error)
		if status != "" {
			require.NoError(t, model.DB.Create(&model.AffiliateCommission{InviterId: 10, InviteeId: 2, SourceKey: "duplicate", ModelName: "a", ConsumedQuota: 100, RewardAmount: 2, Status: status}).Error)
		}
		items := AttachUpstreamCostToLogs([]*model.Log{log})
		stat, err := model.SumUpstreamCost(model.LogFilter{StartTimestamp: 90, EndTimestamp: 110, ModelName: "a", Channel: 1}, false)
		if status == model.AffiliateCommissionStatusCompleted {
			assert.Nil(t, items[0].AffiliateCost, "off-page unknown-cost mirror makes paid tuple ambiguous")
			require.ErrorContains(t, err, "Affiliate cost attribution is ambiguous")
		} else {
			require.NoError(t, err)
			assert.Zero(t, stat.AffiliateCost)
			require.NotNil(t, items[0].AffiliateCost)
			assert.Zero(t, *items[0].AffiliateCost)
		}
	}
}

func testAffiliateCostReadFailures(t *testing.T) {
	require.NoError(t, model.DB.Create(&model.UpstreamCostRecord{RequestId: "failure", UserId: 2, ModelName: "a", Quota: 100, CreatedAt: 100, Status: model.UpstreamCostRecordMatched}).Error)
	require.NoError(t, model.DB.Create(&model.AffiliateCommission{InviterId: 10, InviteeId: 2, SourceKey: "failure", ModelName: "a", ConsumedQuota: 100, RewardAmount: 1, Status: model.AffiliateCommissionStatusCompleted}).Error)
	logs := []*model.Log{
		{Type: model.LogTypeConsume, RequestId: "failure", UserId: 2, ModelName: "a", Quota: 100, CreatedAt: 100},
		{Type: model.LogTypeConsume, RequestId: "no-reward"},
	}
	require.NoError(t, model.DB.Migrator().DropTable(&model.UpstreamCostRecord{}))
	items := AttachUpstreamCostToLogs(logs)
	assert.Nil(t, items[0].AffiliateCost)
	require.NotNil(t, items[1].AffiliateCost)
	assert.Zero(t, *items[1].AffiliateCost)
	require.NoError(t, model.DB.AutoMigrate(&model.UpstreamCostRecord{}))
	require.NoError(t, model.DB.Create(&model.UpstreamCostRecord{RequestId: "failure", UserId: 2, ModelName: "a", Quota: 100, CreatedAt: 100, Status: model.UpstreamCostRecordMatched}).Error)
	require.NoError(t, model.DB.Migrator().DropTable(&model.AffiliateCommission{}))
	items = AttachUpstreamCostToLogs(logs)
	assert.Nil(t, items[0].AffiliateCost)
	require.NotNil(t, items[0].UpstreamCost, "ledger failure must not hide known upstream costs")
	_, err := model.SumUpstreamCost(model.LogFilter{}, false)
	assert.Error(t, err)
}

func TestPricingBaseUSDCoversBillingModes(t *testing.T) {
	usage := upstreamUsage{PromptTokens: 1000, CompletionTokens: 500, CacheTokens: 200}
	tests := []struct {
		name     string
		pricing  model.Pricing
		wantUSD  float64
		wantKind string
		wantOK   bool
	}{
		{
			name:     "ratio pricing discounts cache reads",
			pricing:  model.Pricing{ModelRatio: 2.5, CompletionRatio: 4, CacheRatio: floatPtr(0.1)},
			wantUSD:  (800 + 20 + 2000) * 2.5 / 500000,
			wantKind: upstreamBillingPerToken,
			wantOK:   true,
		},
		{
			name:     "per call pricing ignores tokens",
			pricing:  model.Pricing{QuotaType: 1, ModelPrice: 0.02},
			wantUSD:  0.02,
			wantKind: upstreamBillingPerCall,
			wantOK:   true,
		},
		{
			name:     "expression pricing uses dollars per million tokens",
			pricing:  model.Pricing{BillingMode: "tiered_expr", BillingExpr: `tier("base", p * 2 + c * 8 + cr * 0.2)`},
			wantUSD:  (800*2 + 500*8 + 200*0.2) / 1e6,
			wantKind: upstreamBillingPerToken,
			wantOK:   true,
		},
		{
			name:    "task usage expression cannot be priced by tokens",
			pricing: model.Pricing{BillingMode: "tiered_expr", BillingExpr: `tier("base", u("seconds") * 0.4)`},
			wantOK:  false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			usd, kind, ok := pricingBaseUSD(tt.pricing, 500000, usage)
			require.Equal(t, tt.wantOK, ok)
			if !tt.wantOK {
				return
			}
			assert.InDelta(t, tt.wantUSD, usd, 1e-12)
			assert.Equal(t, tt.wantKind, kind)
		})
	}
}

func TestEvaluateUpstreamInversionComparesEachModelAgainstLowestLocalPrice(t *testing.T) {
	lowest := lowestLocalGroupRatio(
		[]string{"default", "vip"},
		map[string]float64{"default": 1, "vip": 0.9},
		map[string]map[string]float64{"svip": {"vip": 0.8}},
	)
	require.Equal(t, 0.8, lowest)

	result := evaluateUpstreamInversion(upstreamInversionInput{
		Models:       []string{"gpt-a", "img-1", "missing"},
		ModelMapping: map[string]string{"gpt-a": "up-a"},
		LocalPricing: map[string]model.Pricing{
			"gpt-a":   {ModelRatio: 1.25, CompletionRatio: 4},
			"img-1":   {QuotaType: 1, ModelPrice: 0.04},
			"missing": {ModelRatio: 1, CompletionRatio: 1},
		},
		LocalGroupRatio: lowest,
		UpstreamPricing: map[string]model.Pricing{
			"up-a":  {ModelRatio: 1, CompletionRatio: 3},
			"img-1": {ModelRatio: 1, CompletionRatio: 1},
		},
		UpstreamQPU:   500000,
		UpstreamRatio: 1.2,
		CostFactor:    1,
	})

	// Input: upstream 1000*1/500000*1.2 = 0.0024 >= local 1000*1.25/500000*0.8 = 0.002.
	// Output: upstream 0.0072 < local 0.008, so only the input side is inverted.
	require.Len(t, result.Inverted, 1)
	assert.Equal(t, "gpt-a", result.Inverted[0].Model)
	assert.Equal(t, "up-a", result.Inverted[0].UpstreamModel)
	assert.Equal(t, upstreamBasisInput, result.Inverted[0].Basis)
	assert.InDelta(t, 0.0024, result.Inverted[0].UpstreamUSD, 1e-12)
	assert.InDelta(t, 0.002, result.Inverted[0].LocalUSD, 1e-12)
	assert.Equal(t, []string{"img-1"}, result.Mixed)
	assert.Equal(t, []string{"missing"}, result.Unknown)
}

func TestUpstreamKeyRatioPrefersObservedSpecialRatio(t *testing.T) {
	groups := map[string]upstreamGroupState{
		"vip":    {Ratio: 1.5, Public: true},
		"hidden": {Ratio: 2},
	}
	tests := []struct {
		name       string
		group      string
		state      upstreamKeyState
		wantRatio  float64
		wantSource string
	}{
		{
			name:       "account special ratio wins over public ratio",
			group:      "vip",
			state:      upstreamKeyState{Group: "vip", ObservedRatio: 1.2, Special: true, ObservedAt: 100},
			wantRatio:  1.2,
			wantSource: upstreamRatioSourceLog,
		},
		{
			name:       "stale observation follows the current public ratio",
			group:      "vip",
			state:      upstreamKeyState{Group: "vip", ObservedRatio: 1, ObservedAt: 100},
			wantRatio:  1.5,
			wantSource: upstreamRatioSourcePricing,
		},
		{
			name:       "private group uses the observed ratio",
			group:      "hidden",
			state:      upstreamKeyState{Group: "hidden", ObservedRatio: 2.5, ObservedAt: 100},
			wantRatio:  2.5,
			wantSource: upstreamRatioSourceLog,
		},
		{
			name:  "unobserved private group stays unknown",
			group: "hidden",
			state: upstreamKeyState{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ratio, source := upstreamKeyRatio(tt.group, tt.state, groups)
			assert.Equal(t, tt.wantRatio, ratio)
			assert.Equal(t, tt.wantSource, source)
		})
	}
}

func TestApplyUpstreamPublicGroupsMarksOfflineAfterTwoMisses(t *testing.T) {
	groups := map[string]upstreamGroupState{"hidden": {Ratio: 2}}
	applyUpstreamPublicGroups(groups, map[string]upstreamGroupState{"default": {Ratio: 1}, "vip": {Ratio: 1.5}}, 10)

	applyUpstreamPublicGroups(groups, map[string]upstreamGroupState{"default": {Ratio: 1}}, 20)
	assert.False(t, groups["vip"].Offline, "one missing listing is not enough")

	applyUpstreamPublicGroups(groups, map[string]upstreamGroupState{"default": {Ratio: 1}}, 30)
	assert.True(t, groups["vip"].Offline)
	assert.False(t, groups["hidden"].Offline, "log-only groups are never judged by absence")

	applyUpstreamPublicGroups(groups, map[string]upstreamGroupState{"default": {Ratio: 1}, "vip": {Ratio: 1.8}}, 40)
	assert.False(t, groups["vip"].Offline)
	assert.Equal(t, 1.8, groups["vip"].Ratio)
}

func TestFetchUpstreamBalanceNormalizesDisplayUnits(t *testing.T) {
	tests := []struct {
		name          string
		site          model.UpstreamSite
		hardLimit     float64
		totalUsage    float64
		wantUSD       float64
		wantUnlimited bool
	}{
		{name: "CNY display", site: model.UpstreamSite{QuotaDisplayType: "CNY", USDExchangeRate: 7.3}, hardLimit: 73, totalUsage: 730, wantUSD: 9},
		{name: "token display", site: model.UpstreamSite{QuotaDisplayType: "TOKENS", QuotaPerUnit: 500000}, hardLimit: 5000000, totalUsage: 50000000, wantUSD: 9},
		{name: "USD display", site: model.UpstreamSite{QuotaDisplayType: "USD"}, hardLimit: 10, totalUsage: 100, wantUSD: 9},
		{name: "unlimited token", site: model.UpstreamSite{QuotaDisplayType: "CNY", USDExchangeRate: 7.3}, hardLimit: upstreamUnlimitedAmount, wantUnlimited: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "Bearer sk-test", r.Header.Get("Authorization"))
				switch r.URL.Path {
				case "/v1/dashboard/billing/subscription":
					_, _ = w.Write([]byte(`{"hard_limit_usd":` + common.Interface2String(tt.hardLimit) + `}`))
				case "/v1/dashboard/billing/usage":
					_, _ = w.Write([]byte(`{"total_usage":` + common.Interface2String(tt.totalUsage) + `}`))
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			site := tt.site
			site.BaseURL = server.URL

			balance, err := fetchUpstreamBalance(context.Background(), server.Client(), &site, "sk-test")

			require.NoError(t, err)
			assert.Equal(t, tt.wantUnlimited, balance.Unlimited)
			assert.InDelta(t, tt.wantUSD, balance.USD, 1e-9)
		})
	}
}

func TestMatchUpstreamCostRecordsSplitsSharedUpstreamCharge(t *testing.T) {
	setupUpstreamCostTables(t)
	records := []*model.UpstreamCostRecord{
		{RequestId: "local-1", UpstreamRequestId: "up-1", SiteId: 1, Quota: 300, CostQuota: 1, Status: model.UpstreamCostRecordEstimated},
		{RequestId: "local-1", UpstreamRequestId: "up-1", SiteId: 1, Quota: 100, CostQuota: 1, Status: model.UpstreamCostRecordEstimated},
		{RequestId: "local-2", UpstreamRequestId: "up-2", SiteId: 1, Quota: 50, CostQuota: 7, Status: model.UpstreamCostRecordEstimated},
		{RequestId: "local-3", UpstreamRequestId: "up-1", SiteId: 2, Quota: 10, CostQuota: 9, Status: model.UpstreamCostRecordEstimated},
	}
	require.NoError(t, model.InsertUpstreamCostRecords(records))
	site := &model.UpstreamSite{Id: 1, QuotaPerUnit: 1000000, CostFactor: 0.5}
	logs := []upstreamLogEntry{
		{Type: model.LogTypeConsume, RequestId: "up-1", Quota: 8000, Group: "vip", Other: `{"group_ratio":1.5,"user_group_ratio":-1}`},
		{Type: model.LogTypeConsume, RequestId: "up-9", Quota: 10},
	}

	matched, err := matchUpstreamCostRecords(site, logs)

	require.NoError(t, err)
	assert.Equal(t, 2, matched)
	var saved []*model.UpstreamCostRecord
	require.NoError(t, model.DB.Order("id asc").Find(&saved).Error)
	// Local quotas 300:100 split the upstream 8000; the upstream unit is worth
	// half of a local unit and the cost factor halves it again.
	assert.Equal(t, model.UpstreamCostRecordMatched, saved[0].Status)
	assert.Equal(t, 6000, saved[0].UpstreamQuota)
	assert.Equal(t, 1500, saved[0].CostQuota)
	assert.Equal(t, "vip", saved[0].UpstreamGroup)
	assert.Equal(t, 1.5, saved[0].UpstreamGroupRatio)
	assert.Equal(t, 2000, saved[1].UpstreamQuota)
	assert.Equal(t, 500, saved[1].CostQuota)
	assert.Equal(t, model.UpstreamCostRecordEstimated, saved[2].Status)
	assert.Equal(t, model.UpstreamCostRecordEstimated, saved[3].Status, "records of another site keep their estimate")
}

func TestPollSiteLogsBacksOffOnRateLimit(t *testing.T) {
	tests := []struct {
		name        string
		retryAfter  string
		prevBackoff int
		wantBackoff int
	}{
		{name: "honors Retry-After", retryAfter: "120", wantBackoff: 120},
		{name: "doubles the previous backoff up to twenty minutes", prevBackoff: 900, wantBackoff: 1200},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupUpstreamCostTables(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/log/token", r.URL.Path)
				if tt.retryAfter != "" {
					w.Header().Set("Retry-After", tt.retryAfter)
				}
				w.WriteHeader(http.StatusTooManyRequests)
			}))
			defer server.Close()
			baseURL := server.URL
			channel := &model.Channel{Id: 7, Type: 1, Key: "sk-test", Status: common.ChannelStatusEnabled, BaseURL: &baseURL}
			require.NoError(t, model.DB.Create(channel).Error)
			work := &upstreamSiteWork{
				site:   &model.UpstreamSite{Id: 1, BaseURL: baseURL, Status: model.UpstreamSiteStatusNewAPI, LogBackoff: tt.prevBackoff},
				groups: map[string]upstreamGroupState{},
				monitors: []*upstreamMonitorWork{{
					monitor: &model.UpstreamChannelMonitor{ChannelId: 7, Mode: model.UpstreamMonitorModeAuto},
					channel: channel,
					keys:    map[int]upstreamKeyState{},
				}},
				fields: map[string]any{},
			}
			run := &upstreamCostRun{ctx: context.Background(), now: common.GetTimestamp()}

			polled := run.pollSiteLogs(work)

			require.True(t, polled)
			assert.Equal(t, tt.wantBackoff, work.fields["log_backoff"])
			nextAt := work.fields["log_next_at"].(int64)
			polledAt := work.fields["last_log_poll_at"].(int64)
			assert.Equal(t, int64(tt.wantBackoff), nextAt-polledAt)
		})
	}
}

func TestBuildUpstreamCostRecordEstimatesWithUpstreamPrices(t *testing.T) {
	channel := &upstreamCostChannelSnapshot{
		site:         &model.UpstreamSite{Id: 3, QuotaPerUnit: 500000},
		costFactor:   0.9,
		keys:         map[int]upstreamKeyState{1: {EffectiveGroup: "vip", EffectiveRatio: 1.5}},
		group:        "default",
		ratio:        1,
		modelPricing: map[string]model.Pricing{"up-a": {ModelRatio: 1, CompletionRatio: 2}},
	}
	tests := []struct {
		name          string
		upstreamModel string
		localRatio    float64
		wantStatus    int
		wantCost      int
	}{
		// (1000 + 500*2) * 1 / 500000 USD * 1.5 group ratio * 500000 * 0.9 factor.
		{name: "upstream model price", upstreamModel: "up-a", localRatio: 1, wantStatus: model.UpstreamCostRecordEstimated, wantCost: 2700},
		// 1000 local quota scaled by the upstream/local group ratio and factor.
		{name: "group ratio fallback", upstreamModel: "unknown", localRatio: 1, wantStatus: model.UpstreamCostRecordEstimated, wantCost: 1350},
		{name: "no usable price", upstreamModel: "unknown", localRatio: 0, wantStatus: model.UpstreamCostRecordEstimated, wantCost: 1000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			record := buildUpstreamCostRecord(upstreamCostPending{
				record:        &model.UpstreamCostRecord{KeyIndex: 1, Quota: 1000, PromptTokens: 1000, CompletionTokens: 500},
				channel:       channel,
				upstreamModel: tt.upstreamModel,
				localRatio:    tt.localRatio,
			})
			assert.Equal(t, tt.wantStatus, record.Status)
			assert.Equal(t, tt.wantCost, record.CostQuota)
			assert.Equal(t, "vip", record.UpstreamGroup)
			assert.Equal(t, 1.5, record.UpstreamGroupRatio)
		})
	}
}

func TestRecordUpstreamCostPropagatesCacheWriteMetadata(t *testing.T) {
	setting, ok := config.GlobalConfig.Get("upstream_cost_setting").(*upstream_cost_setting.UpstreamCostSetting)
	require.True(t, ok)
	require.NotNil(t, setting)
	previousSetting := *setting
	previousSnapshot := upstreamCostSnapshotPtr.Load()
	previousQueue := upstreamCostQueue
	previousQuotaPerUnit := common.QuotaPerUnit
	t.Cleanup(func() {
		*setting = previousSetting
		upstreamCostSnapshotPtr.Store(previousSnapshot)
		upstreamCostQueue = previousQueue
		common.QuotaPerUnit = previousQuotaPerUnit
	})
	setting.Enabled = true
	common.QuotaPerUnit = 500000
	upstreamCostQueue = make(chan upstreamCostPending, 1)
	upstreamCostSnapshotPtr.Store(&upstreamCostSnapshot{
		channels: map[int]*upstreamCostChannelSnapshot{1: {
			site: &model.UpstreamSite{QuotaPerUnit: 500000}, costFactor: 1, ratio: 1,
			modelPricing: map[string]model.Pricing{"cache-model": {
				BillingMode: "tiered_expr", BillingExpr: `tier("base", p * 2 + c * 4 + cr + cc * 3 + cc1h * 6)`,
			}},
		}},
	})
	for _, tc := range []struct {
		name     string
		prompt   int
		metadata map[string]any
		wantCost int
	}{
		{name: "creation total", prompt: 180, metadata: map[string]any{"cache_creation_tokens": 50}, wantCost: 245},
		{name: "normalized write total", prompt: 180, metadata: map[string]any{"cache_write_tokens": 50}, wantCost: 245},
		{name: "total aliases are not added", prompt: 180, metadata: map[string]any{"cache_creation_tokens": 40, "cache_write_tokens": 50}, wantCost: 245},
		{name: "original total is retained", prompt: 180, metadata: map[string]any{"cache_creation_tokens": 50, "cache_write_tokens": 40}, wantCost: 245},
		{name: "anthropic split writes", prompt: 100, metadata: map[string]any{"usage_semantic": "anthropic", "cache_tokens": 30, "cache_creation_tokens": 50, "cache_creation_tokens_5m": 10, "cache_creation_tokens_1h": 40}, wantCost: 290},
		{name: "request format does not change token semantics", prompt: 180, metadata: map[string]any{"claude": true, "cache_tokens": 30, "cache_write_tokens": 50, "cache_creation_tokens_5m": 10, "cache_creation_tokens_1h": 40}, wantCost: 230},
		{name: "floating point metadata", prompt: 180, metadata: map[string]any{"cache_write_tokens": float64(50)}, wantCost: 245},
		{name: "negative writes are ignored", prompt: 180, metadata: map[string]any{"cache_creation_tokens": -50}, wantCost: 220},
		{name: "oversized writes saturate safely", prompt: 180, metadata: map[string]any{"cache_write_tokens": math.Inf(1)}, wantCost: common.MaxQuota},
		{name: "missing metadata", prompt: 180, wantCost: 220},
	} {
		t.Run(tc.name, func(t *testing.T) {
			other := model.NewLogOther()
			for key, value := range tc.metadata {
				other.SetPublic(key, value)
			}
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			recordUpstreamCostConsumeLog(ctx, &model.Log{Type: model.LogTypeConsume, ChannelId: 1, ModelName: "cache-model", PromptTokens: tc.prompt, CompletionTokens: 20}, other)
			var pending upstreamCostPending
			select {
			case pending = <-upstreamCostQueue:
			default:
				t.Fatal("consume hook did not enqueue an upstream cost record")
			}
			record := buildUpstreamCostRecord(pending)
			assert.Equal(t, tc.wantCost, record.CostQuota)
			assert.Equal(t, tc.prompt, record.PromptTokens)
			assert.Equal(t, model.UpstreamCostRecordEstimated, record.Status)
		})
	}
}

func TestManualUpstreamCostWithoutNewAPISite(t *testing.T) {
	ratio := 0.15
	snapshot := buildUpstreamCostSnapshot("v", nil, []*model.UpstreamChannelMonitor{
		{ChannelId: 1, Mode: model.UpstreamMonitorModeManual, ManualRatio: &ratio},
		{ChannelId: 2, Mode: model.UpstreamMonitorModeAuto},
		{ChannelId: 3, Mode: model.UpstreamMonitorModeOff},
	})
	require.Len(t, snapshot.channels, 1)
	channel := snapshot.channels[1]
	for _, tc := range []struct {
		name       string
		localRatio float64
		wantCost   int
		wantStatus int
	}{
		{name: "local group ratio is removed", localRatio: 0.18, wantCost: 42146, wantStatus: model.UpstreamCostRecordEstimated},
		{name: "missing local ratio cannot be estimated", wantCost: 0, wantStatus: model.UpstreamCostRecordUnknown},
	} {
		t.Run(tc.name, func(t *testing.T) {
			record := buildUpstreamCostRecord(upstreamCostPending{
				record: &model.UpstreamCostRecord{Quota: 50576}, channel: channel, localRatio: tc.localRatio,
			})
			assert.Equal(t, tc.wantStatus, record.Status)
			assert.Equal(t, tc.wantCost, record.CostQuota)
			assert.Equal(t, ratio, record.UpstreamGroupRatio)
		})
	}
}

func TestManualUpstreamCostPrefersPricingAndMatchedCharge(t *testing.T) {
	ratio := 1.5
	site := &model.UpstreamSite{Id: 4, Status: model.UpstreamSiteStatusNewAPI, QuotaPerUnit: 500000, CostFactor: 0.5,
		ModelPricing: `{"up-a":{"model_ratio":1,"completion_ratio":2}}`}
	channel := buildUpstreamCostSnapshot("v", []*model.UpstreamSite{site}, []*model.UpstreamChannelMonitor{
		{ChannelId: 1, SiteId: 4, Mode: model.UpstreamMonitorModeManual, ManualRatio: &ratio},
	}).channels[1]
	record := buildUpstreamCostRecord(upstreamCostPending{
		record:  &model.UpstreamCostRecord{Quota: 1000, PromptTokens: 1000, CompletionTokens: 500},
		channel: channel, upstreamModel: "up-a", localRatio: 4,
	})
	assert.Equal(t, model.UpstreamCostRecordEstimated, record.Status)
	assert.Equal(t, 1500, record.CostQuota)
	record = buildUpstreamCostRecord(upstreamCostPending{
		record: &model.UpstreamCostRecord{Quota: 1000}, channel: channel, upstreamModel: "missing", localRatio: 4,
	})
	assert.Equal(t, model.UpstreamCostRecordEstimated, record.Status)
	assert.Equal(t, 187, record.CostQuota)
}

func TestUpdateUpstreamMonitorRejectsInvalidManualRatio(t *testing.T) {
	for _, value := range []float64{0, -1, 101, math.NaN(), math.Inf(1)} {
		_, err := UpdateUpstreamMonitor(1, model.UpstreamMonitorModeManual, "", &value)
		assert.Error(t, err)
	}
	_, err := UpdateUpstreamMonitor(1, model.UpstreamMonitorModeManual, "", nil)
	assert.Error(t, err)
}

func TestUpstreamStatusRequiresQuotaMetadata(t *testing.T) {
	usd := "USD"
	inCurrency := true
	for _, tt := range []struct {
		name   string
		status upstreamStatusData
		want   bool
	}{
		{name: "version without quota does not identify site", status: upstreamStatusData{Version: "v1", QuotaDisplayType: &usd}},
		{name: "version without display type does not identify site", status: upstreamStatusData{Version: "v1", QuotaPerUnit: 500000}},
		{name: "legacy display flag identifies site without version", status: upstreamStatusData{QuotaPerUnit: 500000, DisplayInCurrency: &inCurrency}, want: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tt.status.isNewAPI())
		})
	}
}

func TestAutoMonitorDetectsCompatibleUpstreamAndReadsPublicPricing(t *testing.T) {
	setupUpstreamCostTables(t)
	logResponse := "empty"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/status":
			_, _ = w.Write([]byte(`{"success":true,"data":{"version":"","system_name":"Upstream","quota_per_unit":500000,"quota_display_type":"USD"}}`))
		case "/api/pricing":
			_, _ = w.Write([]byte(`{"success":true,"group_ratio":{"vip":1.5},"usable_group":{"vip":"VIP"},"data":[{"model_name":"gpt-a","model_ratio":1,"completion_ratio":2}]}`))
		case "/v1/dashboard/billing/subscription":
			if r.Header.Get("Authorization") != "Bearer sk-test" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"hard_limit_usd":10}`))
		case "/v1/dashboard/billing/usage":
			_, _ = w.Write([]byte(`{"total_usage":100}`))
		case "/api/log/token":
			if r.Header.Get("Authorization") != "Bearer sk-test" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if logResponse == "denied" {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			if logResponse == "empty" {
				_, _ = w.Write([]byte(`{"success":true,"data":[]}`))
				return
			}
			_, _ = w.Write([]byte(`{"success":true,"data":[{"type":2,"group":"vip","created_at":123,"other":"{\"group_ratio\":1.5}"}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	baseURL := server.URL
	channel := &model.Channel{Id: 42, Type: 1, Key: "sk-test", Status: common.ChannelStatusEnabled, BaseURL: &baseURL, Models: "gpt-a"}
	require.NoError(t, model.DB.Create(channel).Error)
	site := &model.UpstreamSite{BaseURL: baseURL, Status: model.UpstreamSiteStatusPending, CostFactor: 1}
	require.NoError(t, model.DB.Create(site).Error)
	work := &upstreamSiteWork{
		site: site, groups: map[string]upstreamGroupState{}, fields: map[string]any{},
		monitors: []*upstreamMonitorWork{{
			monitor: &model.UpstreamChannelMonitor{ChannelId: channel.Id, SiteId: site.Id, Mode: model.UpstreamMonitorModeAuto},
			channel: channel, keys: map[int]upstreamKeyState{},
		}},
	}
	run := &upstreamCostRun{ctx: context.Background(), now: time.Now().Unix(), localPricing: map[string]model.Pricing{}, groupRatios: map[string]float64{}}

	run.probeSites([]*upstreamSiteWork{work})
	require.Equal(t, model.UpstreamSiteStatusNewAPI, site.Status)
	run.processSite(work)
	require.Equal(t, model.UpstreamPricingStatusOK, site.PricingStatus)
	assert.Equal(t, model.UpstreamCostStatusUnknown, work.monitors[0].monitor.CostStatus)
	assert.Zero(t, work.monitors[0].monitor.GroupRatio, "a public ratio cannot identify the key's group")
	assert.True(t, work.groups["vip"].Public)

	logResponse = "denied"
	run.now += int64((2 * time.Hour) / time.Second)
	run.processSite(work)
	assert.Equal(t, model.UpstreamCostStatusUnknown, work.monitors[0].monitor.CostStatus)
	assert.Zero(t, work.monitors[0].monitor.GroupRatio)
	assert.Contains(t, work.monitors[0].detail.LastError, "403")

	logResponse = "available"
	run.now += int64((2 * time.Hour) / time.Second)
	run.processSite(work)
	assert.Equal(t, 1.5, work.monitors[0].monitor.GroupRatio)
	assert.Equal(t, "vip", work.monitors[0].monitor.DetectedGroup)
	assert.Equal(t, model.UpstreamCostStatusNormal, work.monitors[0].monitor.CostStatus)
	assert.Empty(t, work.monitors[0].detail.LastError)
	assert.True(t, work.monitors[0].keys[0].BalanceKnown)
	assert.InDelta(t, 9, work.monitors[0].keys[0].BalanceUSD, 1e-9)
}

func TestManualMonitorViewReportsEstimatedCost(t *testing.T) {
	ratio := 1.25
	view := buildUpstreamMonitorView(&model.UpstreamChannelMonitor{
		ChannelId: 1, Mode: model.UpstreamMonitorModeManual, ManualRatio: &ratio,
		CostStatus: model.UpstreamCostStatusUnknown,
	}, nil)
	assert.Equal(t, ratio, view.GroupRatio)
	assert.Equal(t, "manual", view.RatioSource)
	assert.Equal(t, model.UpstreamCostStatusEstimated, view.CostStatus)

	off := buildUpstreamMonitorView(&model.UpstreamChannelMonitor{
		ChannelId: 2, Mode: model.UpstreamMonitorModeOff, ManualRatio: &ratio,
	}, nil)
	assert.Equal(t, model.UpstreamCostStatusUnknown, off.CostStatus)
}

func TestManualMonitorPersistsForUnsupportedChannel(t *testing.T) {
	setupUpstreamCostTables(t)
	channel := &model.Channel{Id: 1729, Type: 3, Status: common.ChannelStatusEnabled}
	require.NoError(t, model.DB.Create(channel).Error)
	ratio := 1.25
	view, err := UpdateUpstreamMonitor(channel.Id, model.UpstreamMonitorModeManual, "", &ratio)
	require.NoError(t, err)
	assert.Equal(t, model.UpstreamMonitorModeManual, view.Mode)
	assert.Equal(t, 0, view.SiteId)
	assert.Equal(t, 1.25, view.GroupRatio)
	assert.Equal(t, "manual", view.RatioSource)

	_, err = UpdateUpstreamMonitor(channel.Id, model.UpstreamMonitorModeAuto, "", nil)
	assert.Error(t, err, "an unsupported channel must not enter automatic monitoring")
	view, err = UpdateUpstreamMonitor(channel.Id, model.UpstreamMonitorModeOff, "", nil)
	require.NoError(t, err)
	assert.Equal(t, model.UpstreamMonitorModeOff, view.Mode)
}

func TestSumUpstreamCostOnlyCountsKnownCosts(t *testing.T) {
	setupUpstreamCostTables(t)
	require.NoError(t, model.InsertUpstreamCostRecords([]*model.UpstreamCostRecord{
		{RequestId: "a", CreatedAt: 100, Username: "alice", ChannelId: 1, Quota: 100, CostQuota: 80, Status: model.UpstreamCostRecordMatched},
		{RequestId: "b", CreatedAt: 200, Username: "alice", ChannelId: 1, Quota: 50, CostQuota: 60, Status: model.UpstreamCostRecordEstimated},
		{RequestId: "c", CreatedAt: 300, Username: "alice", ChannelId: 1, Quota: 30, Status: model.UpstreamCostRecordUnknown},
		{RequestId: "d", CreatedAt: 400, Username: "bob", ChannelId: 2, Quota: 1000, CostQuota: 10, Status: model.UpstreamCostRecordMatched},
	}))

	stat, err := model.SumUpstreamCost(model.LogFilter{EndTimestamp: 350, Username: "al%", Channel: 1}, false)

	require.NoError(t, err)
	assert.Equal(t, model.UpstreamCostStat{Revenue: 150, Cost: 140, CoveredQuota: 150, Matched: 1, Estimated: 1, Unknown: 1}, stat)
}

func TestAttachUpstreamCostToLogsAlignsSharedRequestIds(t *testing.T) {
	setupUpstreamCostTables(t)
	require.NoError(t, model.InsertUpstreamCostRecords([]*model.UpstreamCostRecord{
		{RequestId: "req-1", CreatedAt: 100, ChannelId: 1, ModelName: "gpt-a", Quota: 100, CostQuota: 70, Status: model.UpstreamCostRecordMatched},
		{RequestId: "req-1", CreatedAt: 100, ChannelId: 1, ModelName: "gpt-a", Quota: 40, CostQuota: 30, Status: model.UpstreamCostRecordEstimated},
	}))
	logs := []*model.Log{
		{Type: model.LogTypeConsume, RequestId: "req-1", CreatedAt: 100, ChannelId: 1, ModelName: "gpt-a", Quota: 40},
		{Type: model.LogTypeConsume, RequestId: "req-2", ChannelId: 1, ModelName: "gpt-a", Quota: 5},
	}

	items := AttachUpstreamCostToLogs(logs)

	require.NotNil(t, items[0].UpstreamCost)
	assert.Equal(t, 30, items[0].UpstreamCost.CostQuota)
	assert.Equal(t, model.UpstreamCostRecordEstimated, items[0].UpstreamCost.Status)
	assert.Nil(t, items[1].UpstreamCost)
}

func TestCollectEventsAlertsOnlyOnTransitions(t *testing.T) {
	monitorWork := &upstreamMonitorWork{alert: upstreamAlertState{Ratio: 1}}
	inverted := []UpstreamInvertedModel{{Model: "gpt-a", Basis: upstreamBasisInput}}

	monitorWork.collectEvents("vip", 1.5, true, "vip", inverted)
	require.Len(t, monitorWork.events, 3)
	assert.Equal(t, upstreamEventRatioUp, monitorWork.events[0].kind)
	assert.Equal(t, 1.0, monitorWork.events[0].oldRatio)
	assert.Equal(t, 1.5, monitorWork.events[0].newRatio)
	assert.Equal(t, upstreamEventOffline, monitorWork.events[1].kind)
	assert.Equal(t, upstreamEventInverted, monitorWork.events[2].kind)
	for _, event := range monitorWork.events {
		monitorWork.acknowledge(event)
	}

	monitorWork.events = nil
	monitorWork.collectEvents("vip", 1.5, true, "vip", inverted)
	assert.Empty(t, monitorWork.events, "acknowledged states do not alert again")

	monitorWork.collectEvents("vip", 1.5, true, "", nil)
	assert.Empty(t, monitorWork.events)
	monitorWork.collectEvents("vip", 1.5, true, "", inverted)
	require.Len(t, monitorWork.events, 1, "a resolved inversion alerts again when it returns")
	assert.Equal(t, upstreamEventInverted, monitorWork.events[0].kind)
}

func TestUpstreamCostBaseURLSkipsOfficialAndUnsupportedChannels(t *testing.T) {
	tests := []struct {
		name        string
		channelType int
		baseURL     string
		want        string
	}{
		{name: "normalizes host case and v1 suffix", channelType: 1, baseURL: "https://Up.Example.com/v1/", want: "https://up.example.com"},
		{name: "keeps port and sub path", channelType: 60, baseURL: "http://10.0.0.1:3000/relay/", want: "http://10.0.0.1:3000/relay"},
		{name: "official OpenAI endpoint", channelType: 1, baseURL: "https://api.openai.com", want: ""},
		{name: "official Anthropic endpoint", channelType: 14, baseURL: "https://api.anthropic.com/", want: ""},
		{name: "channel type without new-api upstreams", channelType: 3, baseURL: "https://up.example.com", want: ""},
		{name: "non http scheme", channelType: 1, baseURL: "ftp://up.example.com", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseURL := tt.baseURL
			assert.Equal(t, tt.want, upstreamCostBaseURL(&model.Channel{Type: tt.channelType, BaseURL: &baseURL}))
		})
	}
}

func TestFeishuWebhookSigningAndHostAllowlist(t *testing.T) {
	assert.Equal(t, "HlCPO79Q9DEV0vueksRdi4YcZ8Z6keFaxRnxlpGYwWo=", feishuSign(1599360473, "abc123"))

	tests := []struct {
		url   string
		valid bool
	}{
		{url: "https://open.feishu.cn/open-apis/bot/v2/hook/abc", valid: true},
		{url: "https://open.larksuite.com/open-apis/bot/v2/hook/abc", valid: true},
		{url: "http://open.feishu.cn/open-apis/bot/v2/hook/abc"},
		{url: "https://open.feishu.cn:8443/open-apis/bot/v2/hook/abc"},
		{url: "https://open.feishu.cn.evil.example/open-apis/bot/v2/hook/abc"},
		{url: "https://user@open.feishu.cn/open-apis/bot/v2/hook/abc"},
	}
	for _, tt := range tests {
		t.Run(tt.url, func(t *testing.T) {
			err := ValidateFeishuWebhookURL(tt.url)
			if tt.valid {
				assert.NoError(t, err)
				return
			}
			assert.Error(t, err)
		})
	}
}

func TestUpstreamCostMonitorLeaseAllowsOneOwner(t *testing.T) {
	require.NoError(t, model.DB.Exec("DELETE FROM system_task_locks").Error)
	t.Cleanup(func() { model.DB.Exec("DELETE FROM system_task_locks") })

	acquired, err := model.AcquireNamedLease(upstreamCostLeaseName, "master-a", upstreamCostLeaseTTL)
	require.NoError(t, err)
	require.True(t, acquired)

	acquired, err = model.AcquireNamedLease(upstreamCostLeaseName, "master-b", upstreamCostLeaseTTL)
	require.NoError(t, err)
	assert.False(t, acquired, "a second master must wait for the lease")

	require.NoError(t, model.ReleaseNamedLease("master-a"))
	acquired, err = model.AcquireNamedLease(upstreamCostLeaseName, "master-b", upstreamCostLeaseTTL)
	require.NoError(t, err)
	assert.True(t, acquired)
}

func TestFormatUpstreamCostAlertListsSiteGroupRatiosAndChannels(t *testing.T) {
	site := &model.UpstreamSite{Name: "Up", BaseURL: "https://up.example.com"}
	channels := []upstreamAlertChannel{{id: 12, name: "A"}, {id: 15, name: "B"}}

	title, lines := formatUpstreamCostAlert(site, upstreamCostEvent{kind: upstreamEventRatioUp, group: "vip", oldRatio: 1.5, newRatio: 2}, channels)

	assert.Equal(t, "【上游倍率上调】Up", title)
	assert.Equal(t, []string{
		"上游站点：Up（https://up.example.com）",
		"分组：vip",
		"倍率：1.5 → 2",
		"受影响渠道：#12 A、#15 B",
	}, lines)

	inverted := []upstreamAlertChannel{{id: 12, name: "A", inverted: []UpstreamInvertedModel{
		{Model: "gpt-a", UpstreamModel: "up-a", Basis: upstreamBasisInput, UpstreamUSD: 0.003, LocalUSD: 0.002},
	}}}
	title, lines = formatUpstreamCostAlert(site, upstreamCostEvent{kind: upstreamEventInverted, group: "vip", newRatio: 1.5}, inverted)

	assert.Equal(t, "【成本倒挂】Up", title)
	assert.Equal(t, "#12 A：gpt-a → up-a（输入）上游 $0.003/1K tokens ≥ 本站 $0.002/1K tokens", lines[len(lines)-1])
}

func TestRequestUpstreamCostSnapshotAndQueuedPrice(t *testing.T) {
	previousQPU := common.QuotaPerUnit
	previousSnapshot, previousQueue := upstreamCostSnapshotPtr.Load(), upstreamCostQueue
	setting, ok := config.GlobalConfig.Get("upstream_cost_setting").(*upstream_cost_setting.UpstreamCostSetting)
	require.True(t, ok)
	previousSetting := *setting
	t.Cleanup(func() {
		common.QuotaPerUnit = previousQPU
		upstreamCostSnapshotPtr.Store(previousSnapshot)
		upstreamCostQueue = previousQueue
		*setting = previousSetting
	})
	common.QuotaPerUnit = 500000
	setting.Enabled = true
	price := 0.002
	monitors := []*model.UpstreamChannelMonitor{
		{ChannelId: 1, Mode: model.UpstreamMonitorModeAuto, CostMode: model.UpstreamCostModeRequest, RequestPrice: &price},
		{ChannelId: 2, Mode: model.UpstreamMonitorModeManual, CostMode: model.UpstreamCostModeRequest, RequestPrice: floatPtr(0)},
		{ChannelId: 3, Mode: model.UpstreamMonitorModeOff, CostMode: model.UpstreamCostModeRequest, RequestPrice: &price},
		{ChannelId: 4, SiteId: 9, Mode: model.UpstreamMonitorModeAuto, CostMode: model.UpstreamCostModeRequest, RequestPrice: &price, GroupRatio: 99},
	}
	snapshot := buildUpstreamCostSnapshot("v", []*model.UpstreamSite{{Id: 9, Status: model.UpstreamSiteStatusNewAPI, CostFactor: 99, QuotaPerUnit: 1, ModelPricing: `{"missing":{"model_ratio":99}}`}}, monitors)
	require.Len(t, snapshot.channels, 3)
	for _, tc := range []struct{ channel, want int }{{1, 1000}, {2, 0}, {4, 1000}} {
		record := buildUpstreamCostRecord(upstreamCostPending{
			record:  &model.UpstreamCostRecord{Quota: 0, PromptTokens: 99999, CompletionTokens: 100},
			channel: snapshot.channels[tc.channel], upstreamModel: "missing", localRatio: 100,
			cacheTokens: 10000, cacheWrite: 20000,
		})
		assert.Equal(t, tc.want, record.CostQuota)
		assert.Equal(t, model.UpstreamCostRecordEstimated, record.Status)
		assert.Equal(t, model.UpstreamCostModeRequest, record.CostMode)
		assert.Zero(t, record.UpstreamGroupRatio)
	}
	upstreamCostSnapshotPtr.Store(snapshot)
	upstreamCostQueue = make(chan upstreamCostPending, 2)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	log := &model.Log{Type: model.LogTypeConsume, ChannelId: 1}
	recordUpstreamCostConsumeLog(ctx, log, model.NewLogOther())
	price = 0.01
	monitors[0].CostMode = model.UpstreamCostModeRatio
	upstreamCostSnapshotPtr.Store(buildUpstreamCostSnapshot("v", nil, monitors))
	pending := <-upstreamCostQueue
	assert.Equal(t, 1000, buildUpstreamCostRecord(pending).CostQuota, "queued request keeps original price and mode")
	upstreamCostSnapshotPtr.Store(snapshot)
	penalty := model.NewLogOther()
	penalty.SetPublic("violation_fee", true)
	recordUpstreamCostConsumeLog(ctx, log, penalty)
	log.Type = model.LogTypeError
	recordUpstreamCostConsumeLog(ctx, log, model.NewLogOther())
	assert.Empty(t, upstreamCostQueue)
}

func TestRequestUpstreamCostValidationAndLegacySave(t *testing.T) {
	setupUpstreamCostTables(t)
	previousQPU := common.QuotaPerUnit
	previousSnapshot := upstreamCostSnapshotPtr.Load()
	t.Cleanup(func() { common.QuotaPerUnit = previousQPU; upstreamCostSnapshotPtr.Store(previousSnapshot) })
	common.QuotaPerUnit = 500000
	for _, price := range []*float64{nil, floatPtr(-1), floatPtr(math.NaN()), floatPtr(math.Inf(1)), floatPtr(float64(common.MaxQuota)/common.QuotaPerUnit + 1)} {
		_, err := upstreamRequestCostQuota(price)
		assert.Error(t, err)
	}
	quota, err := upstreamRequestCostQuota(floatPtr(float64(common.MaxQuota) / common.QuotaPerUnit))
	require.NoError(t, err)
	assert.Equal(t, common.MaxQuota, quota)
	channel := &model.Channel{Type: 2, Name: "fixed-cost", Key: "key"}
	require.NoError(t, model.DB.Create(channel).Error)
	mode := model.UpstreamCostModeRequest
	view, err := UpdateUpstreamMonitor(channel.Id, model.UpstreamMonitorModeAuto, "", nil, UpstreamCostConfig{CostMode: &mode, RequestPrice: floatPtr(0)})
	require.NoError(t, err)
	assert.Equal(t, model.UpstreamCostModeRequest, view.CostMode)
	assert.Equal(t, model.UpstreamCostStatusEstimated, view.CostStatus)
	require.Contains(t, upstreamCostSnapshotPtr.Load().channels, channel.Id)
	view, err = UpdateUpstreamMonitor(channel.Id, model.UpstreamMonitorModeManual, "", nil)
	require.NoError(t, err)
	assert.Equal(t, model.UpstreamCostModeRequest, view.CostMode)
	require.NotNil(t, view.RequestPrice)
	assert.Zero(t, *view.RequestPrice)
	_, err = UpdateUpstreamMonitor(channel.Id, model.UpstreamMonitorModeOff, "", nil)
	require.NoError(t, err)
	assert.NotContains(t, upstreamCostSnapshotPtr.Load().channels, channel.Id)
	mode = "invalid"
	_, err = UpdateUpstreamMonitor(channel.Id, model.UpstreamMonitorModeAuto, "", nil, UpstreamCostConfig{CostMode: &mode})
	assert.Error(t, err)
}

func TestRequestUpstreamCostHistoryExcludedFromBills(t *testing.T) {
	setupUpstreamCostTables(t)
	records := []*model.UpstreamCostRecord{
		{SiteId: 1, ChannelId: 1, KeyIndex: 0, UpstreamRequestId: "shared", Quota: 300, CostMode: model.UpstreamCostModeRatio, Status: model.UpstreamCostRecordEstimated},
		{SiteId: 1, ChannelId: 2, KeyIndex: 1, UpstreamRequestId: "shared", Quota: 100, Status: model.UpstreamCostRecordEstimated},
		{SiteId: 1, ChannelId: 3, KeyIndex: 2, UpstreamRequestId: "shared", Quota: 900, CostMode: model.UpstreamCostModeRequest, CostQuota: 55, Status: model.UpstreamCostRecordEstimated},
	}
	require.NoError(t, model.InsertUpstreamCostRecords(records))
	require.NoError(t, model.DB.Model(records[1]).Update("cost_mode", nil).Error)
	keys, err := model.GetUpstreamCostPendingKeys(1, 0)
	require.NoError(t, err)
	assert.Len(t, keys, 2)
	matched, err := matchUpstreamCostRecords(&model.UpstreamSite{Id: 1, QuotaPerUnit: common.QuotaPerUnit, CostFactor: 1}, []upstreamLogEntry{{Type: model.LogTypeConsume, RequestId: "shared", Quota: 800}})
	require.NoError(t, err)
	assert.Equal(t, 2, matched)
	var saved []*model.UpstreamCostRecord
	require.NoError(t, model.DB.Order("id asc").Find(&saved).Error)
	assert.Equal(t, 600, saved[0].CostQuota)
	assert.Equal(t, 200, saved[1].CostQuota)
	assert.Equal(t, 55, saved[2].CostQuota)
	assert.Equal(t, model.UpstreamCostRecordEstimated, saved[2].Status)
}

func TestRequestUpstreamMonitorSkipsRatioAlerts(t *testing.T) {
	monitor := &model.UpstreamChannelMonitor{CostMode: model.UpstreamCostModeRequest, RequestPrice: floatPtr(0), GroupRatio: 1, RatioChangedAt: 1}
	work := &upstreamMonitorWork{
		monitor: monitor, channel: &model.Channel{Status: common.ChannelStatusEnabled},
		keys: map[int]upstreamKeyState{0: {Group: "vip", GroupOffline: true, Error: "unreachable"}},
	}
	(&upstreamCostRun{now: 100}).evaluateMonitor(&upstreamSiteWork{groups: map[string]upstreamGroupState{"vip": {Ratio: 100, Offline: true}}}, work)
	assert.Equal(t, model.UpstreamCostStatusEstimated, monitor.CostStatus)
	assert.Empty(t, work.events)
	assert.Empty(t, work.detail.InvertedModels)
	assert.Equal(t, "unreachable", work.detail.LastError)
	assert.Zero(t, monitor.RatioChangedAt)
}

func TestAffiliateCostAttributionAndFilters(t *testing.T) {
	setupUpstreamCostTables(t)
	records := []*model.UpstreamCostRecord{
		{RequestId: "shared", UserId: 2, ModelName: "a", Quota: 100, CreatedAt: 100, Username: "alice", TokenName: "token", ChannelId: 1, UsingGroup: "vip", CostQuota: 30, Status: model.UpstreamCostRecordMatched},
		{RequestId: "shared", UserId: 3, ModelName: "a", Quota: 100, ChannelId: 2, CostQuota: 20, Status: model.UpstreamCostRecordEstimated},
		{RequestId: "shared", UserId: 2, ModelName: "b", Quota: 100, Status: model.UpstreamCostRecordUnknown},
		{RequestId: "shared", UserId: 2, ModelName: "a", Quota: 50, CostQuota: 10, Status: model.UpstreamCostRecordMatched},
		{RequestId: "internal", UserId: 1, ModelName: "a", Quota: 80, CostQuota: 40, Status: model.UpstreamCostRecordEstimated},
	}
	require.NoError(t, model.InsertUpstreamCostRecords(records))
	for i, r := range records {
		require.NoError(t, model.DB.Create(&model.AffiliateCommission{InviterId: int64(10 + i), SourceKey: r.RequestId, InviteeId: int64(r.UserId), ModelName: r.ModelName, ConsumedQuota: int64(r.Quota), RewardAmount: float64(i) + 0.123456, CreditedQuota: 99, Status: model.AffiliateCommissionStatusCompleted, CreatedAt: 90000}).Error)
	}
	for i, status := range []string{model.AffiliateCommissionStatusPending, model.AffiliateCommissionStatusFailed} {
		require.NoError(t, model.DB.Create(&model.AffiliateCommission{InviterId: int64(20 + i), SourceKey: "shared", InviteeId: 2, ModelName: "a", ConsumedQuota: 100, RewardAmount: 99, Status: status}).Error)
	}
	logs := make([]*model.Log, 0, len(records)+2)
	for _, r := range records {
		logs = append(logs, &model.Log{Type: model.LogTypeConsume, RequestId: r.RequestId, UserId: r.UserId, ModelName: r.ModelName, Quota: r.Quota, ChannelId: r.ChannelId, CreatedAt: r.CreatedAt})
	}
	logs = append(logs, &model.Log{Type: model.LogTypeConsume, RequestId: "no-reward"}, &model.Log{Type: model.LogTypeError, RequestId: "shared"})
	items := AttachUpstreamCostToLogs(logs)
	for i := range records {
		require.NotNil(t, items[i].AffiliateCost)
		assert.InDelta(t, float64(i)+0.123456, *items[i].AffiliateCost, 1e-9)
	}
	require.NotNil(t, items[5].AffiliateCost)
	assert.Zero(t, *items[5].AffiliateCost)
	assert.Nil(t, items[6].AffiliateCost)
	encoded, err := common.Marshal(items[6])
	require.NoError(t, err)
	assert.Contains(t, string(encoded), `"affiliate_cost":null`)
	stat, err := model.SumUpstreamCost(model.LogFilter{StartTimestamp: 90, EndTimestamp: 110, ModelName: "a", Username: "al%", TokenName: "token", Channel: 1, Group: "vip"}, false)
	require.NoError(t, err)
	assert.InDelta(t, 0.123456, stat.AffiliateCost, 1e-9)
	assert.Equal(t, int64(100), stat.Revenue)
	stat, err = model.SumUpstreamCost(model.LogFilter{}, true)
	require.NoError(t, err)
	assert.InDelta(t, 8.493824, stat.AffiliateCost, 1e-9)
	assert.Equal(t, int64(250), stat.Revenue)
	assert.Equal(t, int64(100), stat.Cost)
}
