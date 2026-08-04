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
			"enabled":                setting.Enabled,
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