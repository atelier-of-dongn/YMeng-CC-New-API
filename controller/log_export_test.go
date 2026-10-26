package controller

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// callLogHandler runs a log handler as the given user and returns the JSON
// lines of the response.
func callLogHandler(t *testing.T, handler gin.HandlerFunc, userId int, role int, query string) []map[string]any {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/log?"+query, nil)
	ctx.Set("id", userId)
	ctx.Set("role", role)
	handler(ctx)
	var lines []map[string]any
	for line := range strings.SplitSeq(strings.TrimSpace(recorder.Body.String()), "\n") {
		var value map[string]any
		require.NoError(t, common.UnmarshalJsonStr(line, &value))
		lines = append(lines, value)
	}
	return lines
}

func exportedRequestIds(lines []map[string]any) []any {
	ids := make([]any, 0, len(lines))
	for _, line := range lines[:len(lines)-1] {
		ids = append(ids, line["request_id"])
	}
	return ids
}

// seedExportLogs stores logs of two users: three in the last hour and one
// from 400 days ago.
func seedExportLogs(t *testing.T, mainDB *gorm.DB, logDB *gorm.DB, now int64) {
	t.Helper()
	require.NoError(t, mainDB.Create(&model.Channel{Id: 9, Name: "primary"}).Error)
	logs := []model.Log{
		{UserId: 1, Username: "alice", CreatedAt: now - 3600, Type: model.LogTypeConsume, ModelName: "gpt-a", ChannelId: 9, Quota: 10, PromptTokens: 100, RequestId: "a-1", Other: `{"cache_tokens":100,"cache_creation_tokens":1000000,"cache_creation_tokens_5m":1000000,"admin_info":{"use_channel":["9"]}}`},
		{UserId: 2, Username: "bob", CreatedAt: now - 1800, Type: model.LogTypeConsume, ModelName: "gpt-b", ChannelId: 9, Quota: 20, RequestId: "b-1"},
		{UserId: 1, Username: "alice", CreatedAt: now - 60, Type: model.LogTypeError, ModelName: "gpt-a", RequestId: "a-2"},
		{UserId: 1, Username: "alice", CreatedAt: now - 400*24*3600, Type: model.LogTypeConsume, ModelName: "gpt-a", RequestId: "a-old"},
	}
	for i := range logs {
		require.NoError(t, logDB.Create(&logs[i]).Error)
	}
}

func useLogExportDatabases(t *testing.T, mainDB *gorm.DB, logDB *gorm.DB, mainType common.DatabaseType, logType common.DatabaseType) {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis, previousMemory := common.RedisEnabled, common.MemoryCacheEnabled
	model.DB, model.LOG_DB = mainDB, logDB
	common.SetDatabaseTypes(mainType, logType)
	common.RedisEnabled, common.MemoryCacheEnabled = false, false
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled, common.MemoryCacheEnabled = previousRedis, previousMemory
	})
}

func TestLogExportDatabaseMatrix(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousMaster := common.IsMasterNode
	common.IsMasterNode = true
	t.Cleanup(func() { common.IsMasterNode = previousMaster })
	for _, tc := range []struct {
		kind, env string
		typ       common.DatabaseType
	}{
		{"sqlite", "", common.DatabaseTypeSQLite},
		{"mysql", "AUDIT_MYSQL_DSN", common.DatabaseTypeMySQL},
		{"postgres", "AUDIT_POSTGRES_DSN", common.DatabaseTypePostgreSQL},
		{"clickhouse", "AUDIT_CLICKHOUSE_DSN", common.DatabaseTypeClickHouse},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			dsn := os.Getenv(tc.env)
			if tc.env != "" && dsn == "" {
				t.Skip(tc.env + " is not configured")
			}
			db, isolatedDSN := newAuditTestDatabase(t, tc.kind, dsn)
			mainDB, mainType := db, tc.typ
			if tc.kind == "clickhouse" {
				mainDB, _ = newAuditTestDatabase(t, "sqlite", "")
				mainType = common.DatabaseTypeSQLite
			}
			useLogExportDatabases(t, mainDB, db, mainType, tc.typ)
			require.NoError(t, mainDB.AutoMigrate(&model.Channel{}))
			if tc.kind == "clickhouse" {
				t.Setenv("LOG_SQL_DSN", isolatedDSN)
				require.NoError(t, model.InitLogDB())
			} else {
				require.NoError(t, db.AutoMigrate(&model.Log{}))
			}
			versionSQL := "SELECT version()"
			if tc.kind == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, model.LOG_DB.Raw(versionSQL).Scan(&version).Error)
			t.Logf("log database: %s %s", tc.kind, version)
			now := time.Now().Unix()
			seedExportLogs(t, mainDB, model.LOG_DB, now)
			query := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-2*24*3600, now+3600)

			listed := callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, query)[0]
			require.Equal(t, true, listed["success"])
			assert.EqualValues(t, 2, listed["data"].(map[string]any)["total"])
			listed = callLogHandler(t, GetAllLogs, 3, common.RoleAdminUser, query+"&username=alice")[0]
			require.Equal(t, true, listed["success"])
			assert.EqualValues(t, 2, listed["data"].(map[string]any)["total"])

			own := callLogHandler(t, ExportUserLogs, 1, common.RoleCommonUser, query)
			require.Len(t, own, 3)
			assert.Equal(t, []any{"a-2", "a-1"}, exportedRequestIds(own))
			assert.Equal(t, map[string]any{"success": true, "message": "", "data": map[string]any{"count": float64(2)}}, own[2])
			assert.Equal(t, float64(1), own[0]["id"], "user exports carry list positions, not row ids")
			assert.Empty(t, own[1]["channel_name"])
			assert.NotContains(t, own[1]["other"], "admin_info")
			assert.Contains(t, own[1]["other"], "cache_tokens", "users keep the public cache read count")

			all := callLogHandler(t, ExportAllLogs, 3, common.RoleAdminUser, query+"&model_name=gpt-%25")
			require.Len(t, all, 4)
			assert.Equal(t, []any{"a-2", "b-1", "a-1"}, exportedRequestIds(all))
			assert.Equal(t, "primary", all[2]["channel_name"])
			assert.Contains(t, all[2]["other"], "admin_info")
			assert.Equal(t, true, all[3]["success"])

			verifyLogCacheRateStats(t, now)
		})
	}
}

// verifyLogCacheRateStats adds consume logs beside the seeded ones and checks
// that both stat endpoints average per-request cache rates.
func verifyLogCacheRateStats(t *testing.T, now int64) {
	t.Helper()
	// Seeded in range: alice a-1 (cache write fields present: 100 cache read
	// over 100 input + 100 cache read = 0.5) and bob b-1 (no other = 0).
	logs := []model.Log{
		// A zero cache write field still marks input that excludes cache reads.
		{UserId: 1, Username: "alice", CreatedAt: now - 3600, Type: model.LogTypeConsume, PromptTokens: 100, RequestId: "cache-read-only", Other: `{"cache_tokens":300,"cache_creation_tokens":0}`},
		// Without cache write fields the input already includes cache reads.
		{UserId: 1, Username: "alice", CreatedAt: now - 3500, Type: model.LogTypeConsume, PromptTokens: 1000, RequestId: "cache-included", Other: `{"cache_tokens":900}`},
		{UserId: 1, Username: "alice", CreatedAt: now - 3400, Type: model.LogTypeConsume, RequestId: "cache-zero-denominator", Other: `{"cache_tokens":0}`},
		{UserId: 1, Username: "alice", CreatedAt: now - 3300, Type: model.LogTypeConsume, PromptTokens: 100, RequestId: "cache-missing", Other: `{}`},
		{UserId: 1, Username: "alice", CreatedAt: now - 3200, Type: model.LogTypeConsume, PromptTokens: 100, RequestId: "cache-empty"},
		{UserId: 1, Username: "alice", CreatedAt: now - 3100, Type: model.LogTypeConsume, PromptTokens: 100, RequestId: "cache-object", Other: `{"cache_tokens":{"n":1}}`},
		{UserId: 1, Username: "alice", CreatedAt: now - 3000, Type: model.LogTypeConsume, PromptTokens: 100, RequestId: "cache-text", Other: `{"cache_tokens":"x"}`},
		{UserId: 1, Username: "alice", CreatedAt: now - 2900, Type: model.LogTypeConsume, PromptTokens: 100, RequestId: "cache-null", Other: `{"cache_tokens":null}`},
		{UserId: 1, Username: "alice", CreatedAt: now - 2800, Type: model.LogTypeError, RequestId: "cache-error", Other: `{"cache_tokens":100}`},
		{UserId: 2, Username: "bob", CreatedAt: now - 2700, Type: model.LogTypeConsume, RequestId: "cache-full", Other: `{"cache_tokens":100,"cache_creation_tokens":0}`},
		{UserId: 4, Username: "carol", CreatedAt: now - 2700, Type: model.LogTypeConsume, PromptTokens: 100, RequestId: "cache-carol-miss", Other: `{"cache_tokens":0}`},
	}
	// PostgreSQL 9.6 cannot parse text without risking an error, so the
	// statistics there only promise to skip text that is not shaped like JSON.
	if !common.UsingLogDatabase(common.DatabaseTypePostgreSQL) {
		logs = append(logs, model.Log{UserId: 1, Username: "alice", CreatedAt: now - 2600, Type: model.LogTypeConsume, PromptTokens: 100, RequestId: "cache-malformed", Other: `{malformed`})
	}
	for i := range logs {
		require.NoError(t, model.LOG_DB.Create(&logs[i]).Error)
	}

	cacheRate := func(handler gin.HandlerFunc, username string, role int, query string) any {
		t.Helper()
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/log/stat?"+query, nil)
		ctx.Set("username", username)
		ctx.Set("role", role)
		handler(ctx)
		var response struct {
			Success bool           `json:"success"`
			Data    map[string]any `json:"data"`
		}
		require.NoError(t, common.UnmarshalJsonStr(recorder.Body.String(), &response))
		require.True(t, response.Success, recorder.Body.String())
		return response.Data["cache_rate"]
	}

	query := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-2*24*3600, now+3600)
	// alice: 0.5 (a-1), 0.75 (300 / (100+300)) and 0.9 (900 / 1000); her
	// 0% consume logs stay out of the average.
	assert.InDelta(t, (0.5+0.75+0.9)/3, cacheRate(GetLogsSelfStat, "alice", common.RoleCommonUser, query), 1e-9)
	assert.InDelta(t, 1.0, cacheRate(GetLogsSelfStat, "bob", common.RoleCommonUser, query), 1e-9, "bob's average excludes b-1 at 0% and alice's logs")
	assert.InDelta(t, (0.5+0.75+0.9+1)/4, cacheRate(GetLogsStat, "admin", common.RoleAdminUser, query), 1e-9)
	assert.InDelta(t, 0.0, cacheRate(GetLogsSelfStat, "carol", common.RoleCommonUser, query), 0, "only 0% requests average to 0")
	assert.InDelta(t, 0.0, cacheRate(GetLogsSelfStat, "alice", common.RoleCommonUser, query+"&model_name=none"), 0)
}

func TestLogExportRules(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _ := newAuditTestDatabase(t, "sqlite", "")
	useLogExportDatabases(t, db, db, common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Log{}, &model.QuotaData{}))
	now := time.Now().Unix()
	seedExportLogs(t, db, db, now)
	logSetting := operation_setting.GetLogSetting()
	previousSetting := *logSetting
	t.Cleanup(func() { *logSetting = previousSetting })
	recent := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-2*24*3600, now)
	tooLong := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-366*24*3600, now)

	t.Run("time range", func(t *testing.T) {
		rejected := callLogHandler(t, ExportAllLogs, 3, common.RoleAdminUser, tooLong)
		require.Len(t, rejected, 1)
		assert.Equal(t, false, rejected[0]["success"])
		assert.Equal(t, "The time range cannot exceed {{days}} days", rejected[0]["message_key"])
		assert.Equal(t, map[string]any{"days": float64(365)}, rejected[0]["message_params"])

		assert.Equal(t, false, callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, tooLong)[0]["success"])
		assert.Equal(t, false, callLogHandler(t, GetLogsSelfStat, 1, common.RoleCommonUser, tooLong)[0]["success"])
		assert.Equal(t, true, callLogHandler(t, GetUserLogs, 3, common.RoleAdminUser, tooLong)[0]["success"], "administrators search their own logs without a limit")

		// The dashboard follows the same range instead of its old one-month limit.
		fortyDays := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-40*24*3600, now)
		for _, handler := range []gin.HandlerFunc{GetUserQuotaDates, GetUserFlowQuotaDates} {
			assert.Equal(t, "The time range cannot exceed {{days}} days", callLogHandler(t, handler, 1, common.RoleCommonUser, tooLong)[0]["message_key"])
			assert.Equal(t, true, callLogHandler(t, handler, 1, common.RoleCommonUser, fortyDays)[0]["success"])
		}

		// Without a start, a user's search reaches back the whole range.
		listed := callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, "")[0]
		assert.Equal(t, true, listed["success"])
		assert.EqualValues(t, 2, listed["data"].(map[string]any)["total"])

		logSetting.MaxRangeDays = 400
		assert.Equal(t, true, callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, tooLong)[0]["success"])
		logSetting.MaxRangeDays = previousSetting.MaxRangeDays
	})

	t.Run("user export switch", func(t *testing.T) {
		logSetting.UserExportEnabled = false
		t.Cleanup(func() { logSetting.UserExportEnabled = previousSetting.UserExportEnabled })
		disabled := callLogHandler(t, ExportUserLogs, 1, common.RoleCommonUser, recent)
		require.Len(t, disabled, 1)
		assert.Equal(t, "Log export is disabled", disabled[0]["message_key"])
		assert.Equal(t, true, callLogHandler(t, ExportUserLogs, 3, common.RoleAdminUser, recent)[0]["success"], "administrators export their own logs even when users cannot")
	})

	t.Run("one export per user", func(t *testing.T) {
		release, ok, err := service.AcquireLogExportLock(1)
		require.NoError(t, err)
		require.True(t, ok)
		busy := callLogHandler(t, ExportUserLogs, 1, common.RoleCommonUser, recent)
		require.Len(t, busy, 1)
		assert.Equal(t, "Another log export is running. Try again after it finishes.", busy[0]["message_key"])
		other := callLogHandler(t, ExportUserLogs, 2, common.RoleCommonUser, recent)
		assert.Equal(t, true, other[len(other)-1]["success"], "other users are not blocked")
		release()
		assert.Len(t, callLogHandler(t, ExportUserLogs, 1, common.RoleCommonUser, recent), 3)
	})
}

func TestLogResponseModelVisibility(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _ := newAuditTestDatabase(t, "sqlite", "")
	useLogExportDatabases(t, db, db, common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Log{}))
	settings := operation_setting.GetLogSetting()
	previous := *settings
	t.Cleanup(func() { *settings = previous })
	settings.UserExportEnabled = true
	settings.MaxRangeDays = 365
	assert.Equal(t, "true", config.GlobalConfig.ExportAllConfigs()["log_setting.user_response_model_enabled"])

	const other = `{"response_model":{"requested_model":"requested","upstream_model":"mapped","returned_model":"returned"},"actual_model":"mapped","request_path":"/v1/responses","exact_integer":9007199254740993,"admin_info":{"private":"admin"},"root_info":{"private":"root"},"audit_info":{"private":"audit"}}`
	entry := model.Log{UserId: 1, TokenId: 7, CreatedAt: time.Now().Unix() - 60, Type: model.LogTypeConsume, ModelName: "requested", Other: other}
	require.NoError(t, db.Create(&entry).Error)

	for _, enabled := range []bool{true, false, true} {
		require.NoError(t, config.UpdateConfigFromMap(settings, map[string]string{"user_response_model_enabled": fmt.Sprint(enabled)}))
		for _, tc := range []struct {
			name    string
			handler gin.HandlerFunc
			role    int
			export  bool
			token   bool
			all     bool
		}{
			{name: "user list", handler: GetUserLogs, role: common.RoleCommonUser},
			{name: "user export", handler: ExportUserLogs, role: common.RoleCommonUser, export: true},
			{name: "token query", handler: GetLogByKey, role: common.RoleAdminUser, token: true},
			{name: "admin own list", handler: GetUserLogs, role: common.RoleAdminUser},
			{name: "admin own export", handler: ExportUserLogs, role: common.RoleAdminUser, export: true},
			{name: "root own list", handler: GetUserLogs, role: common.RoleRootUser},
			{name: "root own export", handler: ExportUserLogs, role: common.RoleRootUser, export: true},
			{name: "admin all list", handler: GetAllLogs, role: common.RoleAdminUser, all: true},
			{name: "admin all export", handler: ExportAllLogs, role: common.RoleAdminUser, export: true, all: true},
			{name: "root all list", handler: GetAllLogs, role: common.RoleRootUser, all: true},
			{name: "root all export", handler: ExportAllLogs, role: common.RoleRootUser, export: true, all: true},
		} {
			t.Run(fmt.Sprintf("%s/enabled=%v", tc.name, enabled), func(t *testing.T) {
				handler := tc.handler
				if tc.token {
					handler = func(c *gin.Context) {
						c.Set("token_id", 7)
						GetLogByKey(c)
					}
				}
				lines := callLogHandler(t, handler, 1, tc.role, "")
				var row map[string]any
				switch {
				case tc.export:
					require.Len(t, lines, 2)
					assert.Equal(t, true, lines[1]["success"])
					row = lines[0]
				case tc.token:
					require.Equal(t, true, lines[0]["success"])
					items := lines[0]["data"].([]any)
					require.Len(t, items, 1)
					row = items[0].(map[string]any)
				default:
					require.Equal(t, true, lines[0]["success"])
					items := lines[0]["data"].(map[string]any)["items"].([]any)
					require.Len(t, items, 1)
					row = items[0].(map[string]any)
				}
				var metadata map[string]any
				raw := row["other"].(string)
				require.NoError(t, common.UnmarshalJsonStr(raw, &metadata))
				visible := enabled || (!tc.token && tc.role >= common.RoleAdminUser)
				assert.Equal(t, visible, metadata["response_model"] != nil)
				if visible {
					assert.Equal(t, map[string]any{"requested_model": "requested", "upstream_model": "mapped", "returned_model": "returned"}, metadata["response_model"])
				}
				assert.Equal(t, "requested", row["model_name"])
				assert.Equal(t, "mapped", metadata["actual_model"])
				assert.Equal(t, "/v1/responses", metadata["request_path"])
				assert.Contains(t, raw, "9007199254740993")
				assert.Equal(t, tc.all, metadata["admin_info"] != nil)
				assert.Equal(t, tc.all && tc.role >= common.RoleRootUser, metadata["root_info"] != nil)
				assert.Equal(t, tc.all, metadata["audit_info"] != nil)
			})
		}
	}
	var stored model.Log
	require.NoError(t, db.First(&stored, entry.Id).Error)
	assert.Equal(t, other, stored.Other, "view settings must not alter stored logs")
}

func TestAcquireLogExportLock(t *testing.T) {
	for _, useRedis := range []bool{false, true} {
		t.Run(fmt.Sprintf("redis=%v", useRedis), func(t *testing.T) {
			previousRedis, previousClient := common.RedisEnabled, common.RDB
			common.RedisEnabled = useRedis
			if useRedis {
				server := miniredis.RunT(t)
				common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr()})
				require.NoError(t, common.RDB.Ping(context.Background()).Err())
			}
			t.Cleanup(func() { common.RedisEnabled, common.RDB = previousRedis, previousClient })

			release, ok, err := service.AcquireLogExportLock(1)
			require.NoError(t, err)
			require.True(t, ok)
			_, ok, err = service.AcquireLogExportLock(1)
			require.NoError(t, err)
			assert.False(t, ok, "a second export of the same user must wait")
			releaseOther, ok, err := service.AcquireLogExportLock(2)
			require.NoError(t, err)
			assert.True(t, ok)
			releaseOther()
			release()
			releaseAgain, ok, err := service.AcquireLogExportLock(1)
			require.NoError(t, err)
			assert.True(t, ok, "a finished export frees the user")
			releaseAgain()
		})
	}
}
