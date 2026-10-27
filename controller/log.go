package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// logFilterFromQuery reads the log search shared by the log list, the log
// export, and the log statistics. Username, user ID, token ID, channel, and IP
// are read only for administrators.
func logFilterFromQuery(c *gin.Context, admin bool) (model.LogFilter, error) {
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	filter := model.LogFilter{
		Type:              logType,
		StartTimestamp:    startTimestamp,
		EndTimestamp:      endTimestamp,
		ModelName:         c.Query("model_name"),
		TokenName:         c.Query("token_name"),
		Group:             c.Query("group"),
		RequestId:         c.Query("request_id"),
		UpstreamRequestId: c.Query("upstream_request_id"),
	}
	if !admin {
		return filter, nil
	}
	filter.Username = c.Query("username")
	filter.Channel, _ = strconv.Atoi(c.Query("channel"))
	filter.Ip = strings.TrimSpace(c.Query("ip"))
	if raw := strings.TrimSpace(c.Query("user_id")); raw != "" {
		userId, err := strconv.Atoi(raw)
		if err != nil || userId <= 0 {
			return filter, common.NewMessage("Invalid user ID")
		}
		filter.UserId = userId
	}
	if raw := strings.TrimSpace(c.Query("token_id")); raw != "" {
		tokenId, err := strconv.Atoi(raw)
		if err != nil || tokenId <= 0 {
			return filter, common.NewMessage("Invalid token ID")
		}
		filter.TokenId = tokenId
	}
	return filter, nil
}

// logPageQuery returns the pagination of a log endpoint and rejects the
// negative values that would otherwise remove the SQL LIMIT.
func logPageQuery(c *gin.Context) (*common.PageInfo, error) {
	pageInfo := common.GetPageQuery(c)
	if pageInfo.GetPage() < 1 || pageInfo.GetPageSize() < 1 {
		return nil, common.NewMessage("Invalid pagination")
	}
	return pageInfo, nil
}

// limitLogTimeRange returns the start of a log or dashboard search kept within
// the longest log time range. A missing start reaches back the whole range, and
// time after now does not count toward it.
func limitLogTimeRange(startTimestamp int64, endTimestamp int64) (int64, error) {
	maxRange := operation_setting.GetLogSetting().MaxRangeSeconds()
	end := common.GetTimestamp()
	if endTimestamp != 0 {
		end = min(end, endTimestamp)
	}
	if startTimestamp == 0 {
		return end - maxRange, nil
	}
	if end-startTimestamp > maxRange {
		return 0, common.NewMessage("The time range cannot exceed {{days}} days", map[string]any{"days": maxRange / (24 * 60 * 60)})
	}
	return startTimestamp, nil
}

func GetAllLogs(c *gin.Context) {
	pageInfo, err := logPageQuery(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	filter, err := logFilterFromQuery(c, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	logs, total, err := model.GetAllLogs(filter, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if c.GetInt("role") < common.RoleRootUser {
		model.FormatAdminLogs(logs)
	} else {
		model.FormatRootLogs(logs)
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(service.AttachUpstreamCostToLogs(logs))
	common.ApiSuccess(c, pageInfo)
	return
}

func GetUserLogs(c *gin.Context) {
	pageInfo, err := logPageQuery(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	filter, err := logFilterFromQuery(c, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if c.GetInt("role") < common.RoleAdminUser {
		startTimestamp, err := limitLogTimeRange(filter.StartTimestamp, filter.EndTimestamp)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		filter.StartTimestamp = startTimestamp
	}
	logs, total, err := model.GetUserLogs(c.GetInt("id"), filter, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
	return
}

// ExportAllLogs streams every user's logs matching the search.
func ExportAllLogs(c *gin.Context) {
	exportLogs(c, true)
}

// ExportUserLogs streams the caller's own logs matching the search.
func ExportUserLogs(c *gin.Context) {
	if c.GetInt("role") < common.RoleAdminUser && !operation_setting.GetLogSetting().UserExportEnabled {
		common.ApiErrorT(c, "Log export is disabled")
		return
	}
	exportLogs(c, false)
}

// logExportBatchSize bounds the rows held while attaching upstream cost to an
// administrator export.
const logExportBatchSize = 200

// exportLogs writes one JSON log per line, newest first, and ends with an API
// response object: success with the log count, or the failure. Each user runs
// one export at a time. Regular users stay within the longest log time range;
// administrators may export every matching log.
func exportLogs(c *gin.Context, all bool) {
	filter, err := logFilterFromQuery(c, all)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	role := c.GetInt("role")
	if role < common.RoleAdminUser {
		startTimestamp, err := limitLogTimeRange(filter.StartTimestamp, filter.EndTimestamp)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		filter.StartTimestamp = startTimestamp
	}

	userId := c.GetInt("id")
	release, ok, err := service.AcquireLogExportLock(userId)
	if err != nil {
		common.SysError(common.LogText("failed to lock log export: %s", err.Error()))
		common.ApiErrorT(c, "Failed to export logs")
		return
	}
	if !ok {
		common.ApiErrorT(c, "Another log export is running. Try again after it finishes.")
		return
	}
	defer release()

	c.Header("Content-Type", "application/x-ndjson; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	count := 0
	// The administrator export carries the same upstream cost fields as the
	// list. Rows are buffered so cost lookups stay batched per request id.
	batch := make([]*model.Log, 0, logExportBatchSize)
	writeBatch := func() error {
		if len(batch) == 0 {
			return nil
		}
		if all && common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
			// ClickHouse rows have no stable row id; exports follow the list and
			// number rows by their position in the file.
			for i, item := range batch {
				item.Id = count + i + 1
			}
		}
		items := make([]any, len(batch))
		if all {
			for i, item := range service.AttachUpstreamCostToLogs(batch) {
				items[i] = item
			}
		} else {
			for i, item := range batch {
				items[i] = item
			}
		}
		for _, item := range items {
			line, err := common.Marshal(item)
			if err != nil {
				return err
			}
			if _, err := c.Writer.Write(append(line, '\n')); err != nil {
				return err
			}
			count++
		}
		batch = batch[:0]
		return nil
	}
	writeLog := func(log *model.Log) error {
		batch = append(batch, log)
		if len(batch) < logExportBatchSize {
			return nil
		}
		return writeBatch()
	}
	ctx := c.Request.Context()
	if all {
		err = model.StreamAllLogs(ctx, filter, role, writeLog)
	} else {
		err = model.StreamUserLogs(ctx, userId, filter, role, writeLog)
	}
	if ctx.Err() != nil {
		return
	}
	// The status is already sent, so the result object becomes the last line.
	if err == nil {
		err = writeBatch()
	}
	if err != nil {
		common.SysError(common.LogText("failed to export logs: %s", err.Error()))
		common.ApiErrorT(c, "Failed to export logs")
		return
	}
	common.ApiSuccess(c, gin.H{"count": count})
}

// Deprecated: SearchAllLogs 已废弃，前端未使用该接口。
func SearchAllLogs(c *gin.Context) {
	common.ApiErrorT(c, "This API is deprecated")
}

// Deprecated: SearchUserLogs 已废弃，前端未使用该接口。
func SearchUserLogs(c *gin.Context) {
	common.ApiErrorT(c, "This API is deprecated")
}

func GetLogByKey(c *gin.Context) {
	tokenId := c.GetInt("token_id")
	if tokenId == 0 {
		common.ApiErrorI18n(c, i18n.MsgTokenInvalid)
		return
	}
	logs, err := model.GetLogByTokenId(tokenId)
	if err != nil {
		c.JSON(200, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"message": "",
		"data":    logs,
	})
}

func GetLogsStat(c *gin.Context) {
	filter, err := logFilterFromQuery(c, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	stat, err := model.SumUsedQuota(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"quota":      stat.Quota,
			"rpm":        stat.Rpm,
			"tpm":        stat.Tpm,
			"cache_rate": stat.CacheRate,
		},
	})
	return
}

func GetLogsSelfStat(c *gin.Context) {
	filter, err := logFilterFromQuery(c, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// The caller's own logs are selected by user id, so a renamed user keeps
	// the same statistics.
	filter.UserId = c.GetInt("id")
	if c.GetInt("role") < common.RoleAdminUser {
		if filter.StartTimestamp, err = limitLogTimeRange(filter.StartTimestamp, filter.EndTimestamp); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	quotaNum, err := model.SumUsedQuota(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"quota":      quotaNum.Quota,
			"rpm":        quotaNum.Rpm,
			"tpm":        quotaNum.Tpm,
			"cache_rate": quotaNum.CacheRate,
		},
	})
	return
}
