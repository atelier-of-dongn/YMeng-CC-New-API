package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

const (
	affiliateDefaultPageSize = 20
	affiliateMaxPageSize     = 100
)

// affiliatePaging 解析统一的分页参数。
func affiliatePaging(c *gin.Context) (offset int, limit int) {
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	limit, _ = strconv.Atoi(c.Query("page_size"))
	if limit <= 0 {
		limit = affiliateDefaultPageSize
	}
	if limit > affiliateMaxPageSize {
		limit = affiliateMaxPageSize
	}
	return (page - 1) * limit, limit
}

// GetAffiliateSummary 返回当前用户的推广总览。
func GetAffiliateSummary(c *gin.Context) {
	userId := c.GetInt("id")
	summary, err := model.GetAffiliateSummary(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	summary.Enabled = operation_setting.IsAffiliateEnabled()
	summary.RatePercent = operation_setting.GetAffiliateCommissionRatePercent()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    summary,
	})
}

// GetAffiliateCommissions 返回当前用户的佣金明细。
func GetAffiliateCommissions(c *gin.Context) {
	userId := c.GetInt("id")
	offset, limit := affiliatePaging(c)
	items, total, err := model.GetAffiliateCommissions(userId, offset, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": items,
			"total": total,
		},
	})
}

// GetAffiliateInvitees 返回当前用户邀请的下级用户。
func GetAffiliateInvitees(c *gin.Context) {
	userId := c.GetInt("id")
	offset, limit := affiliatePaging(c)
	items, total, err := model.GetAffiliateInvitees(userId, offset, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": items,
			"total": total,
		},
	})
}

// GetAffiliateAdminSettings 返回推广佣金的管理配置。
func GetAffiliateAdminSettings(c *gin.Context) {
	setting := operation_setting.GetAffiliateSetting()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"enabled":                 setting.Enabled,
			"commission_rate_percent": operation_setting.GetAffiliateCommissionRatePercent(),
		},
	})
}

type affiliateSettingsRequest struct {
	Enabled               *bool `json:"enabled"`
	CommissionRatePercent *int  `json:"commission_rate_percent"`
}

// UpdateAffiliateAdminSettings 更新推广佣金配置。
func UpdateAffiliateAdminSettings(c *gin.Context) {
	var req affiliateSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}

	if req.CommissionRatePercent != nil {
		rate := *req.CommissionRatePercent
		if rate < 0 || rate > 100 {
			common.ApiErrorMsg(c, "佣金比例必须在 0 到 100 之间")
			return
		}
		if err := model.UpdateOption("affiliate_setting.commission_rate_percent", strconv.Itoa(rate)); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if req.Enabled != nil {
		if err := model.UpdateOption("affiliate_setting.enabled", strconv.FormatBool(*req.Enabled)); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	GetAffiliateAdminSettings(c)
}

// GetAffiliateAdminUserCommissions 管理端按邀请人聚合的佣金视图。
func GetAffiliateAdminUserCommissions(c *gin.Context) {
	offset, limit := affiliatePaging(c)
	items, total, err := model.GetAffiliateAdminUserCommissions(c.Query("keyword"), offset, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": items,
			"total": total,
		},
	})
}

const (
	affiliateAnalyticsDefaultPageSize = 20
	affiliateAnalyticsMaxPageSize     = 100
	affiliateAnalyticsMaxRangeSeconds = 366 * 24 * 60 * 60
)

func affiliateAnalyticsRange(c *gin.Context) (int64, int64, bool) {
	start, err := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	if err != nil || start < 0 {
		common.ApiErrorMsg(c, "invalid start_timestamp")
		return 0, 0, false
	}
	end, err := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if err != nil || end < start || end-start > affiliateAnalyticsMaxRangeSeconds {
		common.ApiErrorMsg(c, "invalid end_timestamp")
		return 0, 0, false
	}
	return start, end, true
}

func affiliateAnalyticsPaging(c *gin.Context) (int, int, bool) {
	page := 1
	if value := c.Query("page"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 1_000_000 {
			common.ApiErrorMsg(c, "invalid page")
			return 0, 0, false
		}
		page = parsed
	}
	pageSize := affiliateAnalyticsDefaultPageSize
	if value := c.Query("page_size"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > affiliateAnalyticsMaxPageSize {
			common.ApiErrorMsg(c, "invalid page_size")
			return 0, 0, false
		}
		pageSize = parsed
	}
	return (page - 1) * pageSize, pageSize, true
}

// GetAffiliateAdminAnalyticsOverview returns site-wide referral and commission metrics.
func GetAffiliateAdminAnalyticsOverview(c *gin.Context) {
	start, end, ok := affiliateAnalyticsRange(c)
	if !ok {
		return
	}
	overview, trend, err := model.GetAffiliateAdminAnalyticsOverview(start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"overview": overview, "trend": trend},
	})
}

// GetAffiliateAdminAnalyticsRankings returns inviter rankings for a time range.
func GetAffiliateAdminAnalyticsRankings(c *gin.Context) {
	start, end, ok := affiliateAnalyticsRange(c)
	if !ok {
		return
	}
	offset, limit, ok := affiliateAnalyticsPaging(c)
	if !ok {
		return
	}
	items, total, err := model.GetAffiliateAdminAnalyticsRankings(c.Query("keyword"), start, end, offset, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"items": items, "total": total},
	})
}

// GetAffiliateAdminAnalyticsCommissions returns filtered site-wide commission records.
func GetAffiliateAdminAnalyticsCommissions(c *gin.Context) {
	start, end, ok := affiliateAnalyticsRange(c)
	if !ok {
		return
	}
	offset, limit, ok := affiliateAnalyticsPaging(c)
	if !ok {
		return
	}
	status := c.Query("status")
	if status != "" && status != model.AffiliateCommissionStatusCompleted && status != model.AffiliateCommissionStatusPending && status != model.AffiliateCommissionStatusFailed {
		common.ApiErrorMsg(c, "invalid status")
		return
	}
	items, total, err := model.GetAffiliateAdminAnalyticsCommissions(c.Query("keyword"), status, start, end, offset, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"items": items, "total": total},
	})
}
