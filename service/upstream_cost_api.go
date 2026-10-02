package service

import (
	"context"
	"errors"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/upstream_cost_setting"

	"gorm.io/gorm"
)

const upstreamManualBalanceTimeout = time.Minute

type UpstreamGroupOption struct {
	Name    string  `json:"name"`
	Ratio   float64 `json:"ratio"`
	Public  bool    `json:"public"`
	Offline bool    `json:"offline"`
	Desc    string  `json:"desc"`
}

// UpstreamMonitorView is the channel-list projection of a monitor. It never
// includes channel keys.
type UpstreamMonitorView struct {
	ChannelId        int                     `json:"channel_id"`
	Mode             string                  `json:"mode"`
	SiteId           int                     `json:"site_id"`
	SiteName         string                  `json:"site_name"`
	SiteBaseURL      string                  `json:"site_base_url"`
	SiteStatus       string                  `json:"site_status"`
	PricingStatus    string                  `json:"pricing_status"`
	EffectiveGroup   string                  `json:"effective_group"`
	DetectedGroup    string                  `json:"detected_group"`
	ManualGroup      string                  `json:"manual_group"`
	ManualRatio      *float64                `json:"manual_ratio"`
	GroupMismatch    bool                    `json:"group_mismatch"`
	GroupRatio       float64                 `json:"group_ratio"`
	PrevGroupRatio   float64                 `json:"prev_group_ratio"`
	RatioSource      string                  `json:"ratio_source"`
	RatioChangedAt   int64                   `json:"ratio_changed_at"`
	CostStatus       string                  `json:"cost_status"`
	InvertedModels   []UpstreamInvertedModel `json:"inverted_models"`
	UnknownModels    []string                `json:"unknown_models"`
	MixedModels      []string                `json:"mixed_models"`
	BalanceUnlimited bool                    `json:"balance_unlimited"`
	KeyGroups        []string                `json:"key_groups"`
	LastError        string                  `json:"last_error"`
	Groups           []UpstreamGroupOption   `json:"groups"`
	UpdatedAt        int64                   `json:"updated_at"`
}

type UpstreamSiteView struct {
	*model.UpstreamSite
	ChannelCount int `json:"channel_count"`
}

type UpstreamCostLogView struct {
	Status             int     `json:"status"`
	UpstreamGroup      string  `json:"upstream_group"`
	UpstreamGroupRatio float64 `json:"upstream_group_ratio"`
	UpstreamQuota      int     `json:"upstream_quota"`
	CostQuota          int     `json:"cost_quota"`
}

// AdminLogItem decorates an admin log row with its upstream cost without
// changing the logs table.
type AdminLogItem struct {
	*model.Log
	UpstreamCost *UpstreamCostLogView `json:"upstream_cost,omitempty"`
}

func GetUpstreamMonitorViews(channelIds []int) ([]UpstreamMonitorView, error) {
	monitors, err := model.GetUpstreamChannelMonitors(channelIds)
	if err != nil {
		return nil, err
	}
	sites, err := model.GetUpstreamSites()
	if err != nil {
		return nil, err
	}
	siteById := make(map[int]*model.UpstreamSite, len(sites))
	for _, site := range sites {
		siteById[site.Id] = site
	}
	views := make([]UpstreamMonitorView, 0, len(monitors))
	for _, monitor := range monitors {
		views = append(views, buildUpstreamMonitorView(monitor, siteById[monitor.SiteId]))
	}
	return views, nil
}

func buildUpstreamMonitorView(monitor *model.UpstreamChannelMonitor, site *model.UpstreamSite) UpstreamMonitorView {
	detail := decodeUpstreamJSON[upstreamStatusDetail](monitor.StatusDetail)
	view := UpstreamMonitorView{
		ChannelId:      monitor.ChannelId,
		Mode:           monitor.Mode,
		SiteId:         monitor.SiteId,
		EffectiveGroup: monitor.ManualGroup,
		DetectedGroup:  monitor.DetectedGroup,
		ManualGroup:    monitor.ManualGroup,
		ManualRatio:    monitor.ManualRatio,
		GroupMismatch:  monitor.ManualGroup != "" && monitor.DetectedGroup != "" && monitor.ManualGroup != monitor.DetectedGroup,
		GroupRatio:     monitor.GroupRatio,
		PrevGroupRatio: monitor.PrevGroupRatio,
		RatioSource:    monitor.RatioSource,
		RatioChangedAt: monitor.RatioChangedAt,
		CostStatus:     monitor.CostStatus,
		InvertedModels: detail.InvertedModels,
		UnknownModels:  detail.UnknownModels,
		MixedModels:    detail.MixedModels,
		KeyGroups:      detail.KeyGroups,
		LastError:      detail.LastError,
		Groups:         []UpstreamGroupOption{},
		UpdatedAt:      monitor.UpdatedAt / 1000,
	}
	if monitor.Mode == model.UpstreamMonitorModeManual {
		view.EffectiveGroup = monitor.ManualGroup
		view.GroupMismatch = false
		if monitor.ManualRatio != nil {
			view.GroupRatio = *monitor.ManualRatio
			view.RatioSource = "manual"
		}
		view.PrevGroupRatio = 0
		view.RatioChangedAt = 0
	} else if view.EffectiveGroup == "" {
		view.EffectiveGroup = monitor.DetectedGroup
	}
	for _, state := range decodeUpstreamJSON[map[int]upstreamKeyState](monitor.KeyStates) {
		view.BalanceUnlimited = view.BalanceUnlimited || state.Unlimited
	}
	if view.InvertedModels == nil {
		view.InvertedModels = []UpstreamInvertedModel{}
	}
	if view.UnknownModels == nil {
		view.UnknownModels = []string{}
	}
	if view.MixedModels == nil {
		view.MixedModels = []string{}
	}
	if view.KeyGroups == nil {
		view.KeyGroups = []string{}
	}
	if monitor.Mode != model.UpstreamMonitorModeAuto || site == nil || site.Status != model.UpstreamSiteStatusNewAPI || view.CostStatus == "" {
		view.CostStatus = model.UpstreamCostStatusUnknown
	}
	if site == nil {
		return view
	}
	view.SiteName = site.Name
	view.SiteBaseURL = site.BaseURL
	view.SiteStatus = site.Status
	view.PricingStatus = site.PricingStatus
	if view.LastError == "" {
		view.LastError = site.LastError
	}
	for name, group := range decodeUpstreamJSON[map[string]upstreamGroupState](site.GroupStates) {
		view.Groups = append(view.Groups, UpstreamGroupOption{
			Name:    name,
			Ratio:   group.Ratio,
			Public:  group.Public,
			Offline: group.Offline,
			Desc:    group.Desc,
		})
	}
	slices.SortFunc(view.Groups, func(a, b UpstreamGroupOption) int {
		return strings.Compare(a.Name, b.Name)
	})
	return view
}

func GetUpstreamSiteViews() ([]UpstreamSiteView, error) {
	sites, err := model.GetUpstreamSites()
	if err != nil {
		return nil, err
	}
	monitors, err := model.GetAllUpstreamChannelMonitors()
	if err != nil {
		return nil, err
	}
	channelCounts := make(map[int]int)
	for _, monitor := range monitors {
		if monitor.Mode == model.UpstreamMonitorModeAuto {
			channelCounts[monitor.SiteId]++
		}
	}
	views := make([]UpstreamSiteView, 0, len(sites))
	for _, site := range sites {
		site.UpdatedAt /= 1000
		views = append(views, UpstreamSiteView{UpstreamSite: site, ChannelCount: channelCounts[site.Id]})
	}
	return views, nil
}

// UpdateUpstreamMonitor stores the administrator's monitoring choice for a
// channel, creating the monitor when auto detection has not linked it yet.
func UpdateUpstreamMonitor(channelId int, mode string, manualGroup string, manualRatio *float64) (*UpstreamMonitorView, error) {
	if mode != model.UpstreamMonitorModeAuto && mode != model.UpstreamMonitorModeManual && mode != model.UpstreamMonitorModeOff {
		return nil, errors.New("无效的监控模式")
	}
	if manualRatio != nil && (math.IsNaN(*manualRatio) || math.IsInf(*manualRatio, 0) || *manualRatio <= 0 || *manualRatio > 100) {
		return nil, errors.New("手动倍率必须大于 0 且不超过 100")
	}
	if mode == model.UpstreamMonitorModeManual && manualRatio == nil {
		return nil, errors.New("手动模式需要设置上游倍率")
	}
	manualGroup = strings.TrimSpace(manualGroup)
	if len(manualGroup) > 64 {
		return nil, errors.New("分组名称过长")
	}
	channel, err := model.GetChannelById(channelId, false)
	if err != nil {
		return nil, err
	}
	baseURL := upstreamCostBaseURL(channel)
	if mode == model.UpstreamMonitorModeAuto && baseURL == "" {
		return nil, errors.New("该渠道没有可监控的 new-api 上游地址")
	}
	monitor, err := model.GetUpstreamChannelMonitor(channelId)
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		siteId := 0
		if baseURL != "" {
			site, err := model.GetOrCreateUpstreamSite(baseURL)
			if err != nil {
				return nil, err
			}
			siteId = site.Id
		}
		monitor = &model.UpstreamChannelMonitor{
			ChannelId:   channelId,
			SiteId:      siteId,
			BaseURL:     baseURL,
			Mode:        mode,
			ManualGroup: manualGroup,
			ManualRatio: manualRatio,
			CostStatus:  model.UpstreamCostStatusUnknown,
		}
		if err := model.CreateUpstreamChannelMonitor(monitor); err != nil {
			return nil, err
		}
	case err != nil:
		return nil, err
	default:
		err := model.UpdateUpstreamChannelMonitor(channelId, map[string]any{
			"mode":         mode,
			"manual_group": manualGroup,
			"manual_ratio": manualRatio,
		})
		if err != nil {
			return nil, err
		}
	}
	// Re-evaluate the site on the next monitor tick.
	if monitor.SiteId > 0 {
		if err := model.ResetUpstreamSiteSchedules(monitor.SiteId); err != nil {
			return nil, err
		}
	}
	views, err := GetUpstreamMonitorViews([]int{channelId})
	if err != nil || len(views) == 0 {
		return nil, err
	}
	return &views[0], nil
}

func UpdateUpstreamSiteCostFactor(siteId int, costFactor float64) error {
	if math.IsNaN(costFactor) || math.IsInf(costFactor, 0) || costFactor <= 0 || costFactor > 100 {
		return errors.New("折算系数必须大于 0 且不超过 100")
	}
	if _, err := model.GetUpstreamSiteById(siteId); err != nil {
		return err
	}
	if err := model.UpdateUpstreamSite(siteId, map[string]any{"cost_factor": costFactor}); err != nil {
		return err
	}
	return model.ResetUpstreamSiteSchedules(siteId)
}

// RefreshUpstreamSites asks the master monitor to probe and refresh a site, or
// every site when siteId is 0, on its next tick.
func RefreshUpstreamSites(siteId int) error {
	if !upstream_cost_setting.GetSetting().Enabled {
		return errors.New("上游成本监控未开启")
	}
	return model.ResetUpstreamSiteSchedules(siteId)
}

// SendUpstreamCostTestAlert sends a test message, falling back to the saved
// webhook and secret for empty arguments.
func SendUpstreamCostTestAlert(webhookURL string, secret string) error {
	setting := upstream_cost_setting.GetSetting()
	if strings.TrimSpace(webhookURL) == "" {
		webhookURL = setting.FeishuWebhookURL
	}
	if secret == "" {
		secret = setting.FeishuSecret
	}
	if strings.TrimSpace(webhookURL) == "" {
		return errors.New("请先填写飞书机器人 Webhook 地址")
	}
	return SendFeishuPost(context.Background(), webhookURL, secret, "【测试】上游成本监控", []string{
		"这是一条测试消息，收到即表示飞书机器人配置正确。",
	})
}

// AttachUpstreamCostToLogs adds the upstream cost of consume logs recorded
// through monitored channels.
func AttachUpstreamCostToLogs(logs []*model.Log) []AdminLogItem {
	items := make([]AdminLogItem, len(logs))
	requestIds := make([]string, 0, len(logs))
	for i, log := range logs {
		items[i].Log = log
		if log.Type == model.LogTypeConsume && log.RequestId != "" {
			requestIds = append(requestIds, log.RequestId)
		}
	}
	if len(requestIds) == 0 {
		return items
	}
	records, err := model.GetUpstreamCostRecordsByRequestIds(requestIds)
	if err != nil {
		common.SysError("failed to load upstream cost records: " + err.Error())
		return items
	}
	byRequest := make(map[string][]*model.UpstreamCostRecord)
	for _, record := range records {
		byRequest[record.RequestId] = append(byRequest[record.RequestId], record)
	}
	for i, log := range logs {
		candidates := byRequest[log.RequestId]
		if log.Type != model.LogTypeConsume || len(candidates) == 0 {
			continue
		}
		record := candidates[0]
		// Several consume logs can share one request id; align on the fields
		// both rows copy from the same charge.
		if len(candidates) > 1 {
			index := slices.IndexFunc(candidates, func(candidate *model.UpstreamCostRecord) bool {
				return candidate.ChannelId == log.ChannelId && candidate.Quota == log.Quota && candidate.ModelName == log.ModelName
			})
			if index < 0 {
				continue
			}
			record = candidates[index]
		}
		items[i].UpstreamCost = &UpstreamCostLogView{
			Status:             record.Status,
			UpstreamGroup:      record.UpstreamGroup,
			UpstreamGroupRatio: record.UpstreamGroupRatio,
			UpstreamQuota:      record.UpstreamQuota,
			CostQuota:          record.CostQuota,
		}
	}
	return items
}

// IsUpstreamCostMonitored reports whether a channel is actively monitored
// through a recognized new-api upstream.
func IsUpstreamCostMonitored(channelId int) bool {
	if !upstream_cost_setting.GetSetting().Enabled {
		return false
	}
	snapshot := upstreamCostSnapshotPtr.Load()
	if snapshot == nil {
		return false
	}
	_, ok := snapshot.channels[channelId]
	return ok
}

// RefreshMonitoredChannelBalance refreshes the balance of a monitored channel
// in USD across its enabled keys. monitored is false when the channel is not
// monitored, letting callers fall back to the provider-specific balance query.
func RefreshMonitoredChannelBalance(channel *model.Channel) (balance float64, unlimited bool, monitored bool, err error) {
	if !upstream_cost_setting.GetSetting().Enabled {
		return 0, false, false, nil
	}
	snapshot := upstreamCostSnapshotPtr.Load()
	if snapshot == nil {
		return 0, false, false, nil
	}
	entry, ok := snapshot.channels[channel.Id]
	if !ok || entry.site == nil || entry.mode != model.UpstreamMonitorModeAuto {
		return 0, false, false, nil
	}
	site := entry.site
	client, err := upstreamCostHTTPClient(channel)
	if err != nil {
		return 0, false, true, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), upstreamManualBalanceTimeout)
	defer cancel()
	total := 0.0
	fetched := 0
	var firstErr error
	for _, index := range upstreamKeyIndexes(channel) {
		key, ok := upstreamChannelKey(channel, index)
		if !ok {
			continue
		}
		result, err := fetchUpstreamBalance(ctx, client, site, key)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if result.Unlimited {
			return 0, true, true, nil
		}
		total += result.USD
		fetched++
	}
	if fetched == 0 {
		if firstErr == nil {
			firstErr = errors.New("没有可用的密钥")
		}
		return 0, false, true, firstErr
	}
	(&model.Channel{Id: channel.Id}).UpdateBalance(total)
	return total, false, true, nil
}
