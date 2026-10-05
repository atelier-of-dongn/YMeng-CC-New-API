package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// upstreamMonitorQueryLimit bounds one channel-list page of monitor lookups.
const upstreamMonitorQueryLimit = 200

func GetUpstreamCostMonitors(c *gin.Context) {
	ids := make([]int, 0)
	for part := range strings.SplitSeq(c.Query("ids"), ",") {
		id, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || id <= 0 {
			continue
		}
		ids = append(ids, id)
		if len(ids) >= upstreamMonitorQueryLimit {
			break
		}
	}
	views, err := service.GetUpstreamMonitorViews(ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, views)
}

func UpdateUpstreamCostMonitor(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var request struct {
		Mode        string   `json:"mode"`
		ManualGroup string   `json:"manual_group"`
		ManualRatio *float64 `json:"manual_ratio"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	view, err := service.UpdateUpstreamMonitor(channelId, request.Mode, request.ManualGroup, request.ManualRatio)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

func GetUpstreamCostSites(c *gin.Context) {
	views, err := service.GetUpstreamSiteViews()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, views)
}

func UpdateUpstreamCostSite(c *gin.Context) {
	siteId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var request struct {
		CostFactor float64 `json:"cost_factor"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := service.UpdateUpstreamSiteCostFactor(siteId, request.CostFactor); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func RefreshUpstreamCostSites(c *gin.Context) {
	var request struct {
		SiteId int `json:"site_id"`
	}
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&request); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if err := service.RefreshUpstreamSites(request.SiteId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func TestUpstreamCostFeishu(c *gin.Context) {
	var request struct {
		WebhookURL string `json:"webhook_url"`
		Secret     string `json:"secret"`
	}
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&request); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if err := service.SendUpstreamCostTestAlert(request.WebhookURL, request.Secret); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// GetUpstreamCostStat mirrors GetLogsStat filters over monitored channels.
func GetUpstreamCostStat(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	channel, _ := strconv.Atoi(c.Query("channel"))
	internalAccounting, _ := strconv.ParseBool(c.Query("internal_accounting"))
	stat, err := model.SumUpstreamCost(startTimestamp, endTimestamp, c.Query("model_name"), c.Query("username"), c.Query("token_name"), channel, c.Query("group"), internalAccounting)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, stat)
}
