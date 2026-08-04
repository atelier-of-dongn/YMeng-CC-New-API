package controller

import (
	"net/http"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
)

const clientCountryHeader = "X-Client-Country"

func visibleAutoGroups(c *gin.Context, userGroup string) []string {
	country := c.GetHeader(clientCountryHeader)
	groups := service.GetUserAutoGroup(userGroup)
	visible := make([]string, 0, len(groups))
	for _, group := range groups {
		if setting.IsIpAccessGroupVisible(country, group) {
			visible = append(visible, group)
		}
	}
	return visible
}

func visibleUserGroups(c *gin.Context, userGroup string) map[string]string {
	groups := service.GetUserUsableGroups(userGroup)
	country := c.GetHeader(clientCountryHeader)
	visible := setting.FilterIpAccessVisibleGroups(country, groups)

	autoDescription, hasAuto := groups["auto"]
	if !hasAuto {
		return visible
	}
	for _, group := range service.GetUserAutoGroup(userGroup) {
		if !setting.IsIpAccessGroupVisible(country, group) {
			delete(visible, "auto")
			return visible
		}
	}
	visible["auto"] = autoDescription
	return visible
}

// normalizeCountryCode 只保留两位字母国家码，避免把任意请求头内容回显给前端。
func normalizeCountryCode(country string) string {
	country = strings.ToUpper(strings.TrimSpace(country))
	if len(country) != 2 {
		return ""
	}
	for i := 0; i < len(country); i++ {
		if country[i] < 'A' || country[i] > 'Z' {
			return ""
		}
	}
	return country
}

// ipAccessPolicyModel 弹窗中展示的单个模型条目。
type ipAccessPolicyModel struct {
	ModelName string   `json:"model_name"`
	Groups    []string `json:"groups"`
}

// pricingModelNames 把定价条目压成"模型名 -> 可用分组"的有序列表。
func pricingModelEntries(pricing []model.Pricing) []ipAccessPolicyModel {
	entries := make([]ipAccessPolicyModel, 0, len(pricing))
	for _, item := range pricing {
		groups := append([]string(nil), item.EnableGroup...)
		sort.Strings(groups)
		entries = append(entries, ipAccessPolicyModel{
			ModelName: item.ModelName,
			Groups:    groups,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].ModelName < entries[j].ModelName
	})
	return entries
}

// GetIpAccessPolicyNotice 返回当前访问来源的模型可见性说明。
// 大陆访客据此展示"当前可用模型"与"仅海外可用模型"，纯展示用途，不涉及鉴权。
func GetIpAccessPolicyNotice(c *gin.Context) {
	var group string
	if userId, exists := c.Get("id"); exists {
		if user, err := model.GetUserCache(userId.(int)); err == nil {
			group = user.Group
		}
	}

	country := c.GetHeader(clientCountryHeader)
	restricted := setting.IsIpAccessPolicyRestricted(country)

	pricing := model.GetPricing()
	allGroups := service.GetUserUsableGroups(group)
	allowedGroups := visibleUserGroups(c, group)

	allModels := pricingModelEntries(filterPricingByUsableGroups(pricing, allGroups))
	visibleModels := pricingModelEntries(filterPricingByUsableGroups(pricing, allowedGroups))

	visibleSet := make(map[string]struct{}, len(visibleModels))
	for _, item := range visibleModels {
		visibleSet[item.ModelName] = struct{}{}
	}
	overseasOnly := make([]ipAccessPolicyModel, 0)
	for _, item := range allModels {
		if _, ok := visibleSet[item.ModelName]; !ok {
			overseasOnly = append(overseasOnly, item)
		}
	}

	allowedGroupNames := make([]string, 0, len(allowedGroups))
	for name := range allowedGroups {
		allowedGroupNames = append(allowedGroupNames, name)
	}
	sort.Strings(allowedGroupNames)

	restrictedGroupNames := make([]string, 0)
	for name := range allGroups {
		if _, ok := allowedGroups[name]; !ok {
			restrictedGroupNames = append(restrictedGroupNames, name)
		}
	}
	sort.Strings(restrictedGroupNames)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			// restricted 为 true 时前端才需要提示；false 表示本次访问看到的是全量模型。
			"restricted":             restricted,
			"country":                normalizeCountryCode(country),
			"allowed_groups":         allowedGroupNames,
			"restricted_groups":      restrictedGroupNames,
			"available_models":       visibleModels,
			"overseas_only_models":   overseasOnly,
			"available_model_count":  len(visibleModels),
			"overseas_model_count":   len(overseasOnly),
			"total_model_count":      len(allModels),
		},
	})
}
