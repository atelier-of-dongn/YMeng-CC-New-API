package service

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/model"
)

type upstreamAlertChannel struct {
	id       int
	name     string
	inverted []UpstreamInvertedModel
}

// formatUpstreamCostAlert renders one merged alert. The wording follows the
// other root notifications, which are written in Chinese.
func formatUpstreamCostAlert(site *model.UpstreamSite, event upstreamCostEvent, channels []upstreamAlertChannel) (string, []string) {
	siteName := site.Name
	if siteName == "" {
		siteName = site.BaseURL
	}
	names := make([]string, 0, len(channels))
	for _, channel := range channels {
		names = append(names, fmt.Sprintf("#%d %s", channel.id, channel.name))
	}
	lines := []string{
		fmt.Sprintf("上游站点：%s（%s）", siteName, site.BaseURL),
		"分组：" + event.group,
	}
	var title string
	switch event.kind {
	case upstreamEventRatioUp:
		title = "【上游倍率上调】" + siteName
		lines = append(lines, fmt.Sprintf("倍率：%s → %s", formatUpstreamRatio(event.oldRatio), formatUpstreamRatio(event.newRatio)))
	case upstreamEventOffline:
		title = "【上游分组下线】" + siteName
		lines = append(lines, "下线前倍率："+formatUpstreamRatio(event.newRatio))
	default:
		title = "【成本倒挂】" + siteName
		lines = append(lines, "当前倍率："+formatUpstreamRatio(event.newRatio))
	}
	lines = append(lines, "受影响渠道："+strings.Join(names, "、"))
	if event.kind != upstreamEventInverted {
		return title, lines
	}
	basisLabels := map[string]string{
		upstreamBasisInput:   "输入",
		upstreamBasisOutput:  "输出",
		upstreamBasisPerCall: "按次",
	}
	for _, channel := range channels {
		details := make([]string, 0, len(channel.inverted))
		for _, item := range channel.inverted {
			unit := "/1K tokens"
			if item.Basis == upstreamBasisPerCall {
				unit = "/次"
			}
			modelName := item.Model
			if item.UpstreamModel != item.Model {
				modelName += " → " + item.UpstreamModel
			}
			details = append(details, fmt.Sprintf("%s（%s）上游 $%s%s ≥ 本站 $%s%s",
				modelName, basisLabels[item.Basis], formatUpstreamUSD(item.UpstreamUSD), unit, formatUpstreamUSD(item.LocalUSD), unit))
		}
		lines = append(lines, fmt.Sprintf("#%d %s：%s", channel.id, channel.name, strings.Join(details, "；")))
	}
	return title, lines
}

func formatUpstreamRatio(ratio float64) string {
	if ratio <= 0 {
		return "未知"
	}
	return strconv.FormatFloat(math.Round(ratio*1e6)/1e6, 'f', -1, 64)
}

func formatUpstreamUSD(amount float64) string {
	return strconv.FormatFloat(math.Round(amount*1e6)/1e6, 'f', -1, 64)
}
