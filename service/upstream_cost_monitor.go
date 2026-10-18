package service

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"maps"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/setting/upstream_cost_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	upstreamCostTickInterval        = 15 * time.Second
	upstreamCostLeaseName           = "upstream_cost_monitor"
	upstreamCostLeaseTTL            = 2 * time.Minute
	upstreamCostTickTimeout         = 90 * time.Second
	upstreamCostSiteConcurrency     = 4
	upstreamCostLinkInterval        = time.Minute
	upstreamCostProbeBatch          = 20
	upstreamCostUnsupportedRetry    = 24 * time.Hour
	upstreamCostUnreachableRetry    = time.Hour
	upstreamCostPendingWindow       = 2 * time.Hour
	upstreamCostUnknownGroupPoll    = time.Hour
	upstreamCostStalePoll           = 6 * time.Hour
	upstreamCostMaxBackoff          = 20 * time.Minute
	upstreamCostBalanceKeysPerRound = 20
	upstreamCostCleanupInterval     = time.Hour
	upstreamCostCleanupBatch        = 1000
	upstreamCostCleanupRounds       = 20
	upstreamCostOfflineMisses       = 2
	upstreamCostOrphanSiteGrace     = time.Hour

	upstreamRatioSourcePricing = "pricing"
	upstreamRatioSourceLog     = "log"

	upstreamEventRatioUp  = "ratio_up"
	upstreamEventOffline  = "offline"
	upstreamEventInverted = "inverted"
)

// Channel types that may point at another new-api site through a custom base URL.
var upstreamCostCandidateTypes = []int{
	constant.ChannelTypeOpenAI,
	constant.ChannelTypeCustom,
	constant.ChannelTypeAnthropic,
	constant.ChannelTypeGemini,
	constant.ChannelTypeNewAPI,
}

var (
	upstreamCostMonitorOnce    sync.Once
	upstreamCostMonitorRunning atomic.Bool
	upstreamCostMonitorOwner   string
	// Only the ticker goroutine touches the values below, while it holds
	// upstreamCostMonitorRunning.
	upstreamCostLastLinkSync time.Time
	upstreamCostLastCleanup  time.Time
	upstreamCostAlertRetryAt = make(map[string]int64)
)

type upstreamGroupState struct {
	Ratio     float64 `json:"ratio"`
	Desc      string  `json:"desc,omitempty"`
	Public    bool    `json:"public,omitempty"`
	MissCount int     `json:"miss_count,omitempty"`
	Offline   bool    `json:"offline,omitempty"`
	LastSeen  int64   `json:"last_seen,omitempty"`
}

type upstreamKeyState struct {
	Group          string  `json:"group,omitempty"`
	ObservedRatio  float64 `json:"observed_ratio,omitempty"`
	Special        bool    `json:"special,omitempty"`
	ObservedAt     int64   `json:"observed_at,omitempty"`
	EffectiveGroup string  `json:"effective_group,omitempty"`
	EffectiveRatio float64 `json:"effective_ratio,omitempty"`
	BalanceUSD     float64 `json:"balance_usd,omitempty"`
	BalanceKnown   bool    `json:"balance_known,omitempty"`
	Unlimited      bool    `json:"unlimited,omitempty"`
	BalanceAt      int64   `json:"balance_at,omitempty"`
	GroupOffline   bool    `json:"group_offline,omitempty"`
	LastPollAt     int64   `json:"last_poll_at,omitempty"`
	Error          string  `json:"error,omitempty"`
}

type upstreamStatusDetail struct {
	InvertedModels []UpstreamInvertedModel `json:"inverted_models,omitempty"`
	UnknownModels  []string                `json:"unknown_models,omitempty"`
	MixedModels    []string                `json:"mixed_models,omitempty"`
	KeyGroups      []string                `json:"key_groups,omitempty"`
	LastError      string                  `json:"last_error,omitempty"`
}

// upstreamAlertState remembers what was already reported so alerts fire on
// transitions only.
type upstreamAlertState struct {
	Ratio          float64  `json:"ratio,omitempty"`
	InvertedModels []string `json:"inverted_models,omitempty"`
	Offline        bool     `json:"offline,omitempty"`
}

type upstreamCostEvent struct {
	kind         string
	group        string
	oldRatio     float64
	newRatio     float64
	inverted     []UpstreamInvertedModel
	invertedKeys []string
}

type upstreamMonitorWork struct {
	monitor *model.UpstreamChannelMonitor
	channel *model.Channel
	keys    map[int]upstreamKeyState
	detail  upstreamStatusDetail
	alert   upstreamAlertState
	events  []upstreamCostEvent
	dirty   bool
}

type upstreamSiteWork struct {
	site         *model.UpstreamSite
	groups       map[string]upstreamGroupState
	modelPricing map[string]model.Pricing
	monitors     []*upstreamMonitorWork
	fields       map[string]any
}

type upstreamCostRun struct {
	ctx           context.Context
	now           int64
	localPricing  map[string]model.Pricing
	groupRatios   map[string]float64
	specialRatios map[string]map[string]float64
}

// StartUpstreamCostMonitor polls new-api upstreams from the master node. A
// lease in system_task_locks keeps accidental multi-master deployments from
// polling twice and exhausting upstream rate limits.
func StartUpstreamCostMonitor() {
	upstreamCostMonitorOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		upstreamCostMonitorOwner = "upstream-cost-" + common.GetUUID()
		gopool.Go(func() {
			ticker := time.NewTicker(upstreamCostTickInterval)
			defer ticker.Stop()
			for range ticker.C {
				runUpstreamCostMonitorOnce()
			}
		})
	})
}

func runUpstreamCostMonitorOnce() {
	setting := upstream_cost_setting.GetSetting()
	if !setting.Enabled {
		return
	}
	if !upstreamCostMonitorRunning.CompareAndSwap(false, true) {
		return
	}
	defer upstreamCostMonitorRunning.Store(false)
	defer func() {
		if recovered := recover(); recovered != nil {
			common.SysError(fmt.Sprintf("upstream cost monitor panic: %v", recovered))
		}
	}()

	acquired, err := model.AcquireNamedLease(upstreamCostLeaseName, upstreamCostMonitorOwner, upstreamCostLeaseTTL)
	if err != nil {
		common.SysError("failed to acquire upstream cost monitor lease: " + err.Error())
		return
	}
	if !acquired {
		return
	}
	defer func() {
		if err := model.ReleaseNamedLease(upstreamCostMonitorOwner); err != nil {
			common.SysError("failed to release upstream cost monitor lease: " + err.Error())
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), upstreamCostTickTimeout)
	defer cancel()
	now := time.Now()
	if now.Sub(upstreamCostLastLinkSync) >= upstreamCostLinkInterval {
		if err := syncUpstreamCostLinks(setting.AutoDetect, now.Unix()); err != nil {
			common.SysError("failed to sync upstream cost channels: " + err.Error())
		} else {
			upstreamCostLastLinkSync = now
		}
	}
	works, err := loadUpstreamSiteWorks(now.Unix())
	if err != nil {
		common.SysError("failed to load upstream cost monitors: " + err.Error())
		return
	}

	localPricing := make(map[string]model.Pricing)
	for _, pricing := range model.GetPricing() {
		localPricing[pricing.ModelName] = pricing
	}
	run := &upstreamCostRun{
		ctx:           ctx,
		now:           now.Unix(),
		localPricing:  localPricing,
		groupRatios:   ratio_setting.GetGroupRatioCopy(),
		specialRatios: ratio_setting.GetGroupGroupRatioCopy(),
	}
	run.probeSites(works)

	var wg sync.WaitGroup
	semaphore := make(chan struct{}, upstreamCostSiteConcurrency)
	for _, work := range works {
		if work.site.Status != model.UpstreamSiteStatusNewAPI {
			continue
		}
		wg.Go(func() {
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			defer func() {
				if recovered := recover(); recovered != nil {
					common.SysError(fmt.Sprintf("upstream cost monitor panic on site %d: %v", work.site.Id, recovered))
				}
			}()
			run.processSite(work)
		})
	}
	wg.Wait()

	run.sendAlerts(works, setting)
	saveUpstreamMonitorWorks(works)
	if now.Sub(upstreamCostLastCleanup) >= upstreamCostCleanupInterval {
		cleanupUpstreamCostRecords(setting.RetentionDays, now)
		upstreamCostLastCleanup = now
	}
	reloadUpstreamCostSnapshot(false)
}

// syncUpstreamCostLinks keeps one monitor per candidate channel, linked to the
// site of its normalized base URL, and removes rows of deleted channels.
func syncUpstreamCostLinks(autoDetect bool, now int64) error {
	var channels []*model.Channel
	if err := model.DB.Select("id", "type", "status", "base_url").Find(&channels).Error; err != nil {
		return err
	}
	monitors, err := model.GetAllUpstreamChannelMonitors()
	if err != nil {
		return err
	}
	sites, err := model.GetUpstreamSites()
	if err != nil {
		return err
	}
	siteExists := make(map[int]bool, len(sites))
	for _, site := range sites {
		siteExists[site.Id] = true
	}
	monitorByChannel := make(map[int]*model.UpstreamChannelMonitor, len(monitors))
	for _, monitor := range monitors {
		monitorByChannel[monitor.ChannelId] = monitor
	}
	channelExists := make(map[int]bool, len(channels))
	for _, channel := range channels {
		channelExists[channel.Id] = true
		baseURL := upstreamCostBaseURL(channel)
		monitor := monitorByChannel[channel.Id]
		if monitor == nil {
			if !autoDetect || baseURL == "" || channel.Status != common.ChannelStatusEnabled {
				continue
			}
			site, err := model.GetOrCreateUpstreamSite(baseURL)
			if err != nil {
				return err
			}
			err = model.CreateUpstreamChannelMonitor(&model.UpstreamChannelMonitor{
				ChannelId:  channel.Id,
				SiteId:     site.Id,
				BaseURL:    baseURL,
				Mode:       model.UpstreamMonitorModeAuto,
				CostStatus: model.UpstreamCostStatusUnknown,
			})
			if err != nil {
				return err
			}
			continue
		}
		if monitor.BaseURL == baseURL && (baseURL == "" || siteExists[monitor.SiteId]) {
			continue
		}
		// The channel now points elsewhere: everything learned about the old
		// upstream no longer applies.
		siteId := 0
		if baseURL != "" {
			site, err := model.GetOrCreateUpstreamSite(baseURL)
			if err != nil {
				return err
			}
			siteId = site.Id
		}
		err := model.UpdateUpstreamChannelMonitor(channel.Id, map[string]any{
			"site_id":          siteId,
			"base_url":         baseURL,
			"detected_group":   "",
			"group_ratio":      0,
			"prev_group_ratio": 0,
			"ratio_source":     "",
			"ratio_changed_at": 0,
			"cost_status":      model.UpstreamCostStatusUnknown,
			"status_detail":    "",
			"key_states":       "",
			"alert_state":      "",
		})
		if err != nil {
			return err
		}
	}

	var staleChannels []int
	for _, monitor := range monitors {
		if !channelExists[monitor.ChannelId] {
			staleChannels = append(staleChannels, monitor.ChannelId)
		}
	}
	if err := model.DeleteUpstreamChannelMonitors(staleChannels); err != nil {
		return err
	}

	// Drop sites no monitor references anymore. The grace period protects a
	// site that an administrator request created moments ago.
	monitors, err = model.GetAllUpstreamChannelMonitors()
	if err != nil {
		return err
	}
	referenced := make(map[int]bool, len(monitors))
	for _, monitor := range monitors {
		referenced[monitor.SiteId] = true
	}
	var orphanSites []int
	for _, site := range sites {
		if !referenced[site.Id] && now-site.CreatedAt >= int64(upstreamCostOrphanSiteGrace/time.Second) {
			orphanSites = append(orphanSites, site.Id)
		}
	}
	return model.DeleteUpstreamSites(orphanSites)
}

// loadUpstreamSiteWorks loads the sites with due work and their monitored
// channels. Idle ticks stop after the site query.
func loadUpstreamSiteWorks(now int64) ([]*upstreamSiteWork, error) {
	allSites, err := model.GetUpstreamSites()
	if err != nil {
		return nil, err
	}
	sites := slices.DeleteFunc(allSites, func(site *model.UpstreamSite) bool {
		switch site.Status {
		case model.UpstreamSiteStatusNewAPI:
			return site.PricingNextAt > now && site.LogNextAt > now
		case model.UpstreamSiteStatusPending:
			return false
		default:
			return site.ProbeNextAt > now
		}
	})
	if len(sites) == 0 {
		return nil, nil
	}
	siteIds := make([]int, 0, len(sites))
	for _, site := range sites {
		siteIds = append(siteIds, site.Id)
	}
	var monitors []*model.UpstreamChannelMonitor
	err = model.DB.Where("site_id IN ? AND mode IN ?", siteIds, []string{model.UpstreamMonitorModeAuto, model.UpstreamMonitorModeManual}).Order("channel_id asc").Find(&monitors).Error
	if err != nil {
		return nil, err
	}
	var channelIds []int
	for _, monitor := range monitors {
		channelIds = append(channelIds, monitor.ChannelId)
	}
	channelById := make(map[int]*model.Channel, len(channelIds))
	if len(channelIds) > 0 {
		var channels []*model.Channel
		if err := model.DB.Omit("key").Where("id IN ?", channelIds).Find(&channels).Error; err != nil {
			return nil, err
		}
		for _, channel := range channels {
			channelById[channel.Id] = channel
		}
	}

	workBySite := make(map[int]*upstreamSiteWork, len(sites))
	for _, site := range sites {
		groups := decodeUpstreamJSON[map[string]upstreamGroupState](site.GroupStates)
		if groups == nil {
			groups = make(map[string]upstreamGroupState)
		}
		workBySite[site.Id] = &upstreamSiteWork{
			site:         site,
			groups:       groups,
			modelPricing: decodeUpstreamJSON[map[string]model.Pricing](site.ModelPricing),
			fields:       make(map[string]any),
		}
	}
	for _, monitor := range monitors {
		work := workBySite[monitor.SiteId]
		channel := channelById[monitor.ChannelId]
		if work == nil || channel == nil || monitor.Mode != model.UpstreamMonitorModeAuto {
			continue
		}
		keys := decodeUpstreamJSON[map[int]upstreamKeyState](monitor.KeyStates)
		if keys == nil {
			keys = make(map[int]upstreamKeyState)
		}
		work.monitors = append(work.monitors, &upstreamMonitorWork{
			monitor: monitor,
			channel: channel,
			keys:    keys,
			detail:  decodeUpstreamJSON[upstreamStatusDetail](monitor.StatusDetail),
			alert:   decodeUpstreamJSON[upstreamAlertState](monitor.AlertState),
		})
	}

	works := make([]*upstreamSiteWork, 0, len(sites))
	for _, site := range sites {
		if work := workBySite[site.Id]; len(work.monitors) > 0 {
			works = append(works, work)
		}
	}
	return works, nil
}

func (run *upstreamCostRun) probeSites(works []*upstreamSiteWork) {
	probes := 0
	for _, work := range works {
		site := work.site
		retrying := site.Status == model.UpstreamSiteStatusUnsupported || site.Status == model.UpstreamSiteStatusUnreachable
		if site.Status != model.UpstreamSiteStatusPending && (!retrying || site.ProbeNextAt > run.now) {
			continue
		}
		if probes >= upstreamCostProbeBatch || run.ctx.Err() != nil {
			return
		}
		probes++
		fields := make(map[string]any)
		client, err := upstreamCostHTTPClient(work.monitors[0].channel)
		var status *upstreamStatusData
		if err == nil {
			status, err = fetchUpstreamStatus(run.ctx, client, site.BaseURL)
		}
		switch {
		case err != nil:
			site.Status = model.UpstreamSiteStatusUnreachable
			fields["status"] = site.Status
			fields["probe_next_at"] = run.now + int64(upstreamCostUnreachableRetry/time.Second)
			fields["last_error"] = truncateUpstreamError(err.Error())
		case !status.isNewAPI():
			site.Status = model.UpstreamSiteStatusUnsupported
			fields["status"] = site.Status
			fields["probe_next_at"] = run.now + int64(upstreamCostUnsupportedRetry/time.Second)
			fields["last_error"] = ""
		default:
			applyUpstreamStatus(site, status, fields)
			site.PricingNextAt = 0
			site.LogNextAt = 0
			fields["pricing_next_at"] = 0
			fields["log_next_at"] = 0
			fields["last_error"] = ""
		}
		if err := model.UpdateUpstreamSite(site.Id, fields); err != nil {
			common.SysError(fmt.Sprintf("failed to save upstream site %d: %v", site.Id, err))
		}
	}
}

// applyUpstreamStatus records the identity and quota units of a recognized
// new-api site.
func applyUpstreamStatus(site *model.UpstreamSite, status *upstreamStatusData, fields map[string]any) {
	site.Status = model.UpstreamSiteStatusNewAPI
	site.Name = truncateRunes(status.SystemName, 128)
	site.Version = truncateRunes(status.Version, 64)
	site.QuotaPerUnit = status.QuotaPerUnit
	site.QuotaDisplayType = status.displayType()
	site.USDExchangeRate = status.USDExchangeRate
	fields["status"] = site.Status
	fields["name"] = site.Name
	fields["version"] = site.Version
	fields["quota_per_unit"] = site.QuotaPerUnit
	fields["quota_display_type"] = site.QuotaDisplayType
	fields["usd_exchange_rate"] = site.USDExchangeRate
}

func (run *upstreamCostRun) processSite(work *upstreamSiteWork) {
	evaluate := false
	if work.site.PricingNextAt <= run.now {
		run.refreshSite(work)
		evaluate = true
	}
	if work.site.Status == model.UpstreamSiteStatusNewAPI && work.site.LogNextAt <= run.now && run.pollSiteLogs(work) {
		evaluate = true
	}
	if evaluate && work.site.Status == model.UpstreamSiteStatusNewAPI {
		for _, monitorWork := range work.monitors {
			run.evaluateMonitor(work, monitorWork)
		}
	}
	if len(work.fields) == 0 {
		return
	}
	if err := model.UpdateUpstreamSite(work.site.Id, work.fields); err != nil {
		common.SysError(fmt.Sprintf("failed to save upstream site %d: %v", work.site.Id, err))
	}
}

func (run *upstreamCostRun) refreshSite(work *upstreamSiteWork) {
	site := work.site
	fields := work.fields
	fields["pricing_next_at"] = run.now + int64(upstream_cost_setting.PricingInterval()/time.Second)
	client, err := upstreamCostHTTPClient(work.monitors[0].channel)
	var status *upstreamStatusData
	if err == nil {
		status, err = fetchUpstreamStatus(run.ctx, client, site.BaseURL)
	}
	if err != nil {
		site.PricingStatus = model.UpstreamPricingStatusError
		fields["pricing_status"] = site.PricingStatus
		fields["last_error"] = truncateUpstreamError(err.Error())
		return
	}
	if !status.isNewAPI() {
		site.Status = model.UpstreamSiteStatusUnsupported
		fields["status"] = site.Status
		fields["probe_next_at"] = run.now + int64(upstreamCostUnsupportedRetry/time.Second)
		fields["last_error"] = ""
		return
	}
	applyUpstreamStatus(site, status, fields)

	publicGroups, pricing, pricingStatus, err := fetchUpstreamPublicPricing(run.ctx, client, site.BaseURL, work.upstreamModels())
	site.PricingStatus = pricingStatus
	fields["pricing_status"] = pricingStatus
	fields["last_error"] = ""
	if err != nil {
		fields["last_error"] = truncateUpstreamError(err.Error())
	}
	if publicGroups != nil {
		applyUpstreamPublicGroups(work.groups, publicGroups, run.now)
		fields["group_states"] = encodeUpstreamJSON(work.groups)
		fields["pricing_fetched_at"] = run.now
	}
	if pricing != nil {
		work.modelPricing = pricing
		fields["model_pricing"] = encodeUpstreamJSON(pricing)
	}
	run.refreshBalances(work)
}

// upstreamModels lists the upstream model names the site's channels request.
func (work *upstreamSiteWork) upstreamModels() map[string]bool {
	models := make(map[string]bool)
	for _, monitorWork := range work.monitors {
		mapping := upstreamModelMapping(monitorWork.channel)
		for _, name := range monitorWork.channel.GetModels() {
			name = strings.TrimSpace(name)
			if mapped := mapping[name]; mapped != "" {
				name = mapped
			}
			if name != "" {
				models[name] = true
			}
		}
	}
	return models
}

// fetchUpstreamPublicPricing reads public group ratios and the prices of the
// given upstream models. When the pricing page is disabled or needs a login it
// falls back to the anonymous group list, which carries no model prices.
func fetchUpstreamPublicPricing(ctx context.Context, client *http.Client, baseURL string, models map[string]bool) (map[string]upstreamGroupState, map[string]model.Pricing, string, error) {
	response, err := fetchUpstreamPricing(ctx, client, baseURL)
	if err == nil {
		groups := make(map[string]upstreamGroupState, len(response.GroupRatio))
		for name, ratio := range response.GroupRatio {
			groups[name] = upstreamGroupState{Ratio: ratio, Desc: response.UsableGroup[name]}
		}
		pricing := make(map[string]model.Pricing)
		for _, entry := range response.Data {
			if !models[entry.ModelName] {
				continue
			}
			pricing[entry.ModelName] = model.Pricing{
				ModelName:        entry.ModelName,
				QuotaType:        entry.QuotaType,
				ModelRatio:       entry.ModelRatio,
				ModelPrice:       entry.ModelPrice,
				CompletionRatio:  entry.CompletionRatio,
				CacheRatio:       entry.CacheRatio,
				CreateCacheRatio: entry.CreateCacheRatio,
				EnableGroup:      entry.EnableGroup,
				BillingMode:      entry.BillingMode,
				BillingExpr:      entry.BillingExpr,
			}
		}
		return groups, pricing, model.UpstreamPricingStatusOK, nil
	}
	if status := upstreamErrorStatus(err); status != http.StatusUnauthorized && status != http.StatusForbidden {
		return nil, nil, model.UpstreamPricingStatusError, err
	}
	groups, err := fetchUpstreamUserGroups(ctx, client, baseURL)
	if err != nil {
		return nil, nil, model.UpstreamPricingStatusError, err
	}
	// Prices are unknown without the pricing page; clearing them avoids
	// judging inversion against stale prices.
	return groups, map[string]model.Pricing{}, model.UpstreamPricingStatusGroupsOnly, nil
}

// applyUpstreamPublicGroups merges one successful public group listing. A
// previously public group that is missing from consecutive listings goes
// offline; groups only known from logs are private and never judged by
// absence.
func applyUpstreamPublicGroups(groups map[string]upstreamGroupState, listed map[string]upstreamGroupState, now int64) {
	for name, entry := range listed {
		state := groups[name]
		state.Ratio = entry.Ratio
		state.Desc = entry.Desc
		state.Public = true
		state.MissCount = 0
		state.Offline = false
		state.LastSeen = now
		groups[name] = state
	}
	for name, state := range groups {
		if _, ok := listed[name]; ok || !state.Public {
			continue
		}
		state.MissCount++
		state.Offline = state.MissCount >= upstreamCostOfflineMisses
		groups[name] = state
	}
}

func (run *upstreamCostRun) refreshBalances(work *upstreamSiteWork) {
	for _, monitorWork := range work.monitors {
		if run.ctx.Err() != nil {
			return
		}
		channel, err := model.GetChannelById(monitorWork.channel.Id, true)
		if err != nil {
			continue
		}
		client, err := upstreamCostHTTPClient(channel)
		if err != nil {
			continue
		}
		indexes := upstreamKeyIndexes(channel)
		for index := range monitorWork.keys {
			if !slices.Contains(indexes, index) {
				delete(monitorWork.keys, index)
			}
		}
		slices.SortStableFunc(indexes, func(a, b int) int {
			return cmp.Compare(monitorWork.keys[a].BalanceAt, monitorWork.keys[b].BalanceAt)
		})
		for _, index := range indexes[:min(len(indexes), upstreamCostBalanceKeysPerRound)] {
			key, ok := upstreamChannelKey(channel, index)
			if !ok {
				continue
			}
			state := monitorWork.keys[index]
			balance, err := fetchUpstreamBalance(run.ctx, client, work.site, key)
			state.BalanceAt = run.now
			if err != nil {
				group := monitorWork.monitor.ManualGroup
				if group == "" {
					group = state.Group
				}
				state.Error = truncateUpstreamError(err.Error())
				state.GroupOffline = upstreamGroupUnavailable(err, group)
			} else {
				state.BalanceUSD = balance.USD
				state.BalanceKnown = !balance.Unlimited
				state.Unlimited = balance.Unlimited
				state.GroupOffline = false
				state.Error = ""
			}
			monitorWork.keys[index] = state
		}
		monitorWork.dirty = true
		writeUpstreamChannelBalance(channel.Id, monitorWork.keys)
	}
}

// writeUpstreamChannelBalance stores the summed key balance in USD. The
// balance column cannot express an unlimited key, so it is left untouched.
func writeUpstreamChannelBalance(channelId int, keys map[int]upstreamKeyState) {
	total := 0.0
	known := false
	for _, state := range keys {
		if state.Unlimited {
			return
		}
		if state.BalanceKnown {
			total += state.BalanceUSD
			known = true
		}
	}
	if known {
		(&model.Channel{Id: channelId}).UpdateBalance(total)
	}
}

// upstreamGroupUnavailable recognizes new-api's 403 responses for tokens whose
// group was removed or is no longer usable.
func upstreamGroupUnavailable(err error, group string) bool {
	var httpErr *upstreamHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusForbidden {
		return false
	}
	if strings.Contains(httpErr.Message, "均已不可用") {
		return true
	}
	return group != "" && strings.Contains(httpErr.Message, "分组") && strings.Contains(httpErr.Message, group)
}

// pollSiteLogs reads the token log of one key per call, because every key of
// a site shares the upstream's per-IP limit on token log requests. It reports
// whether a request was made.
func (run *upstreamCostRun) pollSiteLogs(work *upstreamSiteWork) bool {
	site := work.site
	interval := int64(upstream_cost_setting.LogPollInterval() / time.Second)
	pending, err := model.GetUpstreamCostPendingKeys(site.Id, run.now-int64(upstreamCostPendingWindow/time.Second))
	if err != nil {
		common.SysError(fmt.Sprintf("failed to list pending upstream cost keys of site %d: %v", site.Id, err))
		return false
	}
	type pollCandidate struct {
		monitorWork *upstreamMonitorWork
		index       int
		priority    int
		lastPollAt  int64
	}
	var candidates []pollCandidate
	for _, monitorWork := range work.monitors {
		for _, index := range upstreamKeyIndexes(monitorWork.channel) {
			state := monitorWork.keys[index]
			priority := -1
			switch {
			case slices.Contains(pending, model.UpstreamCostPendingKey{ChannelId: monitorWork.channel.Id, KeyIndex: index}):
				priority = 0
			case state.Group == "" && run.now-state.LastPollAt >= int64(upstreamCostUnknownGroupPoll/time.Second):
				priority = 1
			case run.now-state.LastPollAt >= int64(upstreamCostStalePoll/time.Second):
				priority = 2
			}
			if priority >= 0 {
				candidates = append(candidates, pollCandidate{monitorWork: monitorWork, index: index, priority: priority, lastPollAt: state.LastPollAt})
			}
		}
	}
	if len(candidates) == 0 {
		work.fields["log_next_at"] = run.now + interval
		return false
	}
	chosen := slices.MinFunc(candidates, func(a, b pollCandidate) int {
		if a.priority != b.priority {
			return cmp.Compare(a.priority, b.priority)
		}
		return cmp.Compare(a.lastPollAt, b.lastPollAt)
	})

	channel, err := model.GetChannelById(chosen.monitorWork.channel.Id, true)
	var key string
	var client *http.Client
	if err == nil {
		var ok bool
		if key, ok = upstreamChannelKey(channel, chosen.index); !ok {
			err = errors.New("channel key not found")
		}
	}
	if err == nil {
		client, err = upstreamCostHTTPClient(channel)
	}
	if err != nil {
		work.fields["log_next_at"] = run.now + interval
		return false
	}

	requestedAt := time.Now().Unix()
	logs, err := fetchUpstreamTokenLogs(run.ctx, client, site.BaseURL, key)
	state := chosen.monitorWork.keys[chosen.index]
	state.LastPollAt = requestedAt
	work.fields["last_log_poll_at"] = requestedAt
	chosen.monitorWork.dirty = true
	var httpErr *upstreamHTTPError
	if errors.As(err, &httpErr) && httpErr.StatusCode == http.StatusTooManyRequests {
		backoff := max(httpErr.RetryAfter, 2*time.Duration(site.LogBackoff)*time.Second, time.Minute)
		backoff = min(backoff, upstreamCostMaxBackoff)
		work.fields["log_backoff"] = int(backoff / time.Second)
		work.fields["log_next_at"] = requestedAt + int64(backoff/time.Second)
		chosen.monitorWork.keys[chosen.index] = state
		return true
	}
	// The next request waits a full interval after this one was sent.
	work.fields["log_backoff"] = 0
	work.fields["log_next_at"] = requestedAt + interval
	if err != nil {
		state.Error = truncateUpstreamError(err.Error())
		chosen.monitorWork.keys[chosen.index] = state
		return true
	}
	state.Error = ""
	if _, err := matchUpstreamCostRecords(site, logs); err != nil {
		common.SysError(fmt.Sprintf("failed to match upstream cost records of site %d: %v", site.Id, err))
	}

	var latest *upstreamLogEntry
	for i := range logs {
		if logs[i].Type == model.LogTypeConsume && logs[i].Group != "" && (latest == nil || logs[i].CreatedAt > latest.CreatedAt) {
			latest = &logs[i]
		}
	}
	if latest != nil {
		ratio, special := latest.ratios()
		state.Group = latest.Group
		state.ObservedRatio = ratio
		state.Special = special
		state.ObservedAt = latest.CreatedAt
		// Groups hidden from the public pricing page are only known from logs.
		if listed := work.groups[latest.Group]; !listed.Public {
			listed.Ratio = ratio
			listed.LastSeen = latest.CreatedAt
			work.groups[latest.Group] = listed
			work.fields["group_states"] = encodeUpstreamJSON(work.groups)
		}
	}
	chosen.monitorWork.keys[chosen.index] = state
	return true
}

// matchUpstreamCostRecords replaces estimates with the exact upstream charge.
// Local records sharing one upstream request split its charge by local quota.
func matchUpstreamCostRecords(site *model.UpstreamSite, logs []upstreamLogEntry) (int, error) {
	byRequest := make(map[string]*upstreamLogEntry)
	for i := range logs {
		if logs[i].Type == model.LogTypeConsume && logs[i].RequestId != "" {
			byRequest[logs[i].RequestId] = &logs[i]
		}
	}
	if len(byRequest) == 0 {
		return 0, nil
	}
	records, err := model.GetUnmatchedUpstreamCostRecords(site.Id, slices.Collect(maps.Keys(byRequest)))
	if err != nil {
		return 0, err
	}
	grouped := make(map[string][]*model.UpstreamCostRecord)
	for _, record := range records {
		if model.NormalizeUpstreamCostMode(record.CostMode) != model.UpstreamCostModeRequest {
			grouped[record.UpstreamRequestId] = append(grouped[record.UpstreamRequestId], record)
		}
	}
	costFactor := upstreamCostFactor(site)
	matched := 0
	for requestId, group := range grouped {
		entry := byRequest[requestId]
		groupRatio, _ := entry.ratios()
		localTotal := 0
		for _, record := range group {
			localTotal += max(record.Quota, 0)
		}
		remaining := entry.Quota
		for i, record := range group {
			share := remaining
			if i < len(group)-1 {
				if localTotal > 0 {
					share = common.QuotaFromFloat(float64(entry.Quota) * float64(max(record.Quota, 0)) / float64(localTotal))
				} else {
					share = entry.Quota / len(group)
				}
				remaining -= share
			}
			err := model.UpdateUpstreamCostRecord(record.Id, map[string]any{
				"status":               model.UpstreamCostRecordMatched,
				"upstream_quota":       share,
				"cost_quota":           upstreamQuotaToLocal(share, site.QuotaPerUnit, costFactor),
				"upstream_group":       entry.Group,
				"upstream_group_ratio": groupRatio,
			})
			if err != nil {
				return matched, err
			}
			matched++
		}
	}
	return matched, nil
}

func (run *upstreamCostRun) evaluateMonitor(work *upstreamSiteWork, monitorWork *upstreamMonitorWork) {
	monitor := monitorWork.monitor
	channel := monitorWork.channel
	if model.NormalizeUpstreamCostMode(monitor.CostMode) == model.UpstreamCostModeRequest {
		monitor.CostStatus = model.UpstreamCostStatusEstimated
		if _, err := upstreamRequestCostQuota(monitor.RequestPrice); err != nil {
			monitor.CostStatus = model.UpstreamCostStatusUnknown
		}
		monitor.PrevGroupRatio, monitor.RatioChangedAt = 0, 0
		monitorWork.detail = upstreamStatusDetail{}
		for _, state := range monitorWork.keys {
			if state.Error != "" {
				monitorWork.detail.LastError = state.Error
				break
			}
		}
		monitorWork.dirty = true
		return
	}
	bestGroup, bestSource, detected, lastError, offlineGroup := "", "", "", "", ""
	bestRatio := 0.0
	keyGroups := make([]string, 0)
	for _, index := range upstreamKeyIndexes(channel) {
		state := monitorWork.keys[index]
		if lastError == "" {
			lastError = state.Error
		}
		if detected == "" {
			detected = state.Group
		}
		group := monitor.ManualGroup
		if group == "" {
			group = state.Group
		}
		state.EffectiveGroup = group
		state.EffectiveRatio = 0
		if group == "" {
			monitorWork.keys[index] = state
			continue
		}
		ratio, source := upstreamKeyRatio(group, state, work.groups)
		state.EffectiveRatio = ratio
		monitorWork.keys[index] = state
		if !slices.Contains(keyGroups, group) {
			keyGroups = append(keyGroups, group)
		}
		if offlineGroup == "" && (work.groups[group].Offline || state.GroupOffline) {
			offlineGroup = group
		}
		// Multi-key channels report their most expensive key.
		if source != "" && (bestSource == "" || ratio > bestRatio) {
			bestGroup, bestRatio, bestSource = group, ratio, source
			if state.Group != "" {
				detected = state.Group
			}
		}
	}

	if bestSource != "" && monitor.GroupRatio > 0 && bestRatio > 0 && math.Abs(bestRatio-monitor.GroupRatio) > 1e-9 {
		monitor.PrevGroupRatio = monitor.GroupRatio
		monitor.RatioChangedAt = run.now
	}
	monitor.DetectedGroup = detected
	monitor.GroupRatio = bestRatio
	monitor.RatioSource = bestSource

	inversion := upstreamInversionResult{}
	if bestSource != "" && len(work.modelPricing) > 0 {
		inversion = evaluateUpstreamInversion(upstreamInversionInput{
			Models:          channel.GetModels(),
			ModelMapping:    upstreamModelMapping(channel),
			LocalPricing:    run.localPricing,
			LocalGroupRatio: lowestLocalGroupRatio(channel.GetGroups(), run.groupRatios, run.specialRatios),
			UpstreamPricing: work.modelPricing,
			UpstreamQPU:     work.site.QuotaPerUnit,
			UpstreamRatio:   bestRatio,
			CostFactor:      upstreamCostFactor(work.site),
		})
	}

	hold := int64(upstream_cost_setting.RatioChangeHold() / time.Second)
	switch {
	case len(inversion.Inverted) > 0:
		monitor.CostStatus = model.UpstreamCostStatusInverted
	case offlineGroup != "":
		monitor.CostStatus = model.UpstreamCostStatusGroupOffline
	case bestSource == "":
		monitor.CostStatus = model.UpstreamCostStatusUnknown
	case monitor.RatioChangedAt > 0 && run.now-monitor.RatioChangedAt < hold:
		monitor.CostStatus = model.UpstreamCostStatusRatioChanged
	default:
		monitor.CostStatus = model.UpstreamCostStatusNormal
	}
	monitorWork.detail = upstreamStatusDetail{
		InvertedModels: inversion.Inverted,
		UnknownModels:  inversion.Unknown,
		MixedModels:    inversion.Mixed,
		KeyGroups:      keyGroups,
		LastError:      lastError,
	}
	monitorWork.dirty = true
	if channel.Status == common.ChannelStatusEnabled {
		monitorWork.collectEvents(bestGroup, bestRatio, bestSource != "", offlineGroup, inversion.Inverted)
	}
}

// upstreamKeyRatio resolves the group ratio a key pays. A special ratio seen in
// the key's upstream logs wins; otherwise the public ratio applies, and a
// private group falls back to its last observed ratio.
func upstreamKeyRatio(group string, state upstreamKeyState, groups map[string]upstreamGroupState) (float64, string) {
	observed := state.Group == group && state.ObservedAt > 0
	if observed && state.Special {
		return state.ObservedRatio, upstreamRatioSourceLog
	}
	if listed, ok := groups[group]; ok && listed.Public {
		return listed.Ratio, upstreamRatioSourcePricing
	}
	if observed {
		return state.ObservedRatio, upstreamRatioSourceLog
	}
	return 0, ""
}

// collectEvents compares the evaluation with what was already alerted and
// queues transitions worth an alert.
func (monitorWork *upstreamMonitorWork) collectEvents(group string, ratio float64, ratioKnown bool, offlineGroup string, inverted []UpstreamInvertedModel) {
	alert := &monitorWork.alert
	if ratioKnown && ratio > 0 {
		if alert.Ratio > 0 && ratio > alert.Ratio*(1+1e-9) {
			monitorWork.events = append(monitorWork.events, upstreamCostEvent{kind: upstreamEventRatioUp, group: group, oldRatio: alert.Ratio, newRatio: ratio})
		} else {
			alert.Ratio = ratio
		}
	}
	if offlineGroup != "" && !alert.Offline {
		offlineRatio := ratio
		if offlineGroup != group {
			offlineRatio = 0
		}
		monitorWork.events = append(monitorWork.events, upstreamCostEvent{kind: upstreamEventOffline, group: offlineGroup, newRatio: offlineRatio})
	}
	if offlineGroup == "" {
		alert.Offline = false
	}
	invertedKeys := make([]string, 0, len(inverted))
	hasNew := false
	for _, item := range inverted {
		key := item.Model + "|" + item.Basis
		invertedKeys = append(invertedKeys, key)
		if !slices.Contains(alert.InvertedModels, key) {
			hasNew = true
		}
	}
	if hasNew {
		monitorWork.events = append(monitorWork.events, upstreamCostEvent{kind: upstreamEventInverted, group: group, newRatio: ratio, inverted: inverted, invertedKeys: invertedKeys})
		return
	}
	// Resolved models drop out so that a later inversion alerts again.
	alert.InvertedModels = slices.DeleteFunc(alert.InvertedModels, func(key string) bool {
		return !slices.Contains(invertedKeys, key)
	})
}

func (monitorWork *upstreamMonitorWork) acknowledge(event upstreamCostEvent) {
	switch event.kind {
	case upstreamEventRatioUp:
		monitorWork.alert.Ratio = event.newRatio
	case upstreamEventOffline:
		monitorWork.alert.Offline = true
	case upstreamEventInverted:
		monitorWork.alert.InvertedModels = event.invertedKeys
	}
}

// sendAlerts merges events per site, group and transition into one Feishu
// message each. Failed sends are retried once per pricing interval; without a
// webhook the events are acknowledged silently.
func (run *upstreamCostRun) sendAlerts(works []*upstreamSiteWork, setting upstream_cost_setting.UpstreamCostSetting) {
	type alertTarget struct {
		monitorWork *upstreamMonitorWork
		event       upstreamCostEvent
	}
	type alertGroup struct {
		site    *model.UpstreamSite
		event   upstreamCostEvent
		targets []alertTarget
	}
	groups := make(map[string]*alertGroup)
	var order []string
	for _, work := range works {
		for _, monitorWork := range work.monitors {
			for _, event := range monitorWork.events {
				key := fmt.Sprintf("%s|%d|%s|%g|%g", event.kind, work.site.Id, event.group, event.oldRatio, event.newRatio)
				group, ok := groups[key]
				if !ok {
					group = &alertGroup{site: work.site, event: event}
					groups[key] = group
					order = append(order, key)
				}
				group.targets = append(group.targets, alertTarget{monitorWork: monitorWork, event: event})
			}
		}
	}
	for key, retryAt := range upstreamCostAlertRetryAt {
		if run.now-retryAt > int64((24 * time.Hour).Seconds()) {
			delete(upstreamCostAlertRetryAt, key)
		}
	}
	for _, key := range order {
		group := groups[key]
		if setting.FeishuWebhookURL != "" {
			if retryAt, ok := upstreamCostAlertRetryAt[key]; ok && run.now < retryAt {
				continue
			}
			channels := make([]upstreamAlertChannel, 0, len(group.targets))
			for _, target := range group.targets {
				channels = append(channels, upstreamAlertChannel{
					id:       target.monitorWork.channel.Id,
					name:     target.monitorWork.channel.Name,
					inverted: target.event.inverted,
				})
			}
			title, lines := formatUpstreamCostAlert(group.site, group.event, channels)
			if err := SendFeishuPost(context.Background(), setting.FeishuWebhookURL, setting.FeishuSecret, title, lines); err != nil {
				common.SysError("failed to send upstream cost alert: " + err.Error())
				upstreamCostAlertRetryAt[key] = run.now + int64(upstream_cost_setting.PricingInterval()/time.Second)
				continue
			}
			delete(upstreamCostAlertRetryAt, key)
		}
		for _, target := range group.targets {
			target.monitorWork.acknowledge(target.event)
		}
	}
}

func saveUpstreamMonitorWorks(works []*upstreamSiteWork) {
	for _, work := range works {
		for _, monitorWork := range work.monitors {
			if !monitorWork.dirty {
				continue
			}
			monitor := monitorWork.monitor
			err := model.UpdateUpstreamChannelMonitor(monitor.ChannelId, map[string]any{
				"detected_group":   monitor.DetectedGroup,
				"group_ratio":      monitor.GroupRatio,
				"prev_group_ratio": monitor.PrevGroupRatio,
				"ratio_source":     monitor.RatioSource,
				"ratio_changed_at": monitor.RatioChangedAt,
				"cost_status":      monitor.CostStatus,
				"status_detail":    encodeUpstreamJSON(monitorWork.detail),
				"key_states":       encodeUpstreamJSON(monitorWork.keys),
				"alert_state":      encodeUpstreamJSON(monitorWork.alert),
			})
			if err != nil {
				common.SysError(fmt.Sprintf("failed to save upstream monitor of channel %d: %v", monitor.ChannelId, err))
			}
		}
	}
}

// cleanupUpstreamCostRecords enforces the retention period in bounded batches.
func cleanupUpstreamCostRecords(retentionDays int, now time.Time) {
	if retentionDays <= 0 {
		return
	}
	before := now.AddDate(0, 0, -retentionDays).Unix()
	for range upstreamCostCleanupRounds {
		deleted, err := model.DeleteOldUpstreamCostRecords(before, upstreamCostCleanupBatch)
		if err != nil {
			common.SysError("failed to delete old upstream cost records: " + err.Error())
			return
		}
		if deleted < upstreamCostCleanupBatch {
			return
		}
	}
}

// upstreamCostBaseURL returns the normalized site URL a channel may relay to,
// or "" when the channel cannot point at another new-api site.
func upstreamCostBaseURL(channel *model.Channel) string {
	if !slices.Contains(upstreamCostCandidateTypes, channel.Type) || channel.BaseURL == nil {
		return ""
	}
	baseURL := normalizeUpstreamSiteURL(*channel.BaseURL)
	if baseURL == "" {
		return ""
	}
	if official := constant.GetChannelBaseURL(channel.Type); official != "" && normalizeUpstreamSiteURL(official) == baseURL {
		return ""
	}
	return baseURL
}

// normalizeUpstreamSiteURL keeps scheme, host and path, dropping a trailing
// "/v1" so that channels configured with or without it share one site.
func normalizeUpstreamSiteURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return ""
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return ""
	}
	path := strings.TrimRight(parsed.Path, "/")
	path, _ = strings.CutSuffix(path, "/v1")
	return scheme + "://" + strings.ToLower(parsed.Host) + strings.TrimRight(path, "/")
}

// upstreamKeyIndexes lists the channel keys still enabled locally.
func upstreamKeyIndexes(channel *model.Channel) []int {
	if !channel.ChannelInfo.IsMultiKey {
		return []int{0}
	}
	indexes := make([]int, 0, channel.ChannelInfo.MultiKeySize)
	for index := range channel.ChannelInfo.MultiKeySize {
		if status, ok := channel.ChannelInfo.MultiKeyStatusList[index]; ok && status != common.ChannelStatusEnabled {
			continue
		}
		indexes = append(indexes, index)
	}
	return indexes
}

// upstreamChannelKey returns the key the relay sends for a key index. Single
// key channels send their whole key field.
func upstreamChannelKey(channel *model.Channel, index int) (string, bool) {
	if !channel.ChannelInfo.IsMultiKey {
		key := strings.TrimSpace(channel.Key)
		return key, index == 0 && key != ""
	}
	keys := channel.GetKeys()
	if index < 0 || index >= len(keys) {
		return "", false
	}
	key := strings.TrimSpace(keys[index])
	return key, key != ""
}

func upstreamModelMapping(channel *model.Channel) map[string]string {
	mapping := make(map[string]string)
	if raw := strings.TrimSpace(channel.GetModelMapping()); raw != "" {
		_ = common.UnmarshalJsonStr(raw, &mapping)
	}
	return mapping
}

func upstreamCostFactor(site *model.UpstreamSite) float64 {
	if site.CostFactor <= 0 || math.IsNaN(site.CostFactor) || math.IsInf(site.CostFactor, 0) {
		return 1
	}
	return site.CostFactor
}

func decodeUpstreamJSON[T any](raw string) T {
	var value T
	if raw != "" {
		_ = common.UnmarshalJsonStr(raw, &value)
	}
	return value
}

func encodeUpstreamJSON(value any) string {
	data, err := common.Marshal(value)
	if err != nil {
		common.SysError("failed to encode upstream cost state: " + err.Error())
		return ""
	}
	return string(data)
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}
