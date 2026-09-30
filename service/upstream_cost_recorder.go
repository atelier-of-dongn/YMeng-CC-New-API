package service

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/upstream_cost_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

const (
	upstreamCostQueueSize      = 10000
	upstreamCostBatchSize      = 200
	upstreamCostFlushInterval  = 2 * time.Second
	upstreamCostSnapshotReload = 30 * time.Second
)

// upstreamCostChannelSnapshot is the immutable per-channel view the consume
// hook and the batch writer use to attribute and estimate upstream cost.
type upstreamCostChannelSnapshot struct {
	site         *model.UpstreamSite
	costFactor   float64
	keys         map[int]upstreamKeyState
	group        string
	ratio        float64
	modelPricing map[string]model.Pricing
}

type upstreamCostSnapshot struct {
	version  string
	channels map[int]*upstreamCostChannelSnapshot
}

type upstreamCostPending struct {
	record        *model.UpstreamCostRecord
	channel       *upstreamCostChannelSnapshot
	upstreamModel string
	cacheTokens   int
	localRatio    float64
}

var (
	upstreamCostRecorderOnce sync.Once
	upstreamCostSnapshotPtr  atomic.Pointer[upstreamCostSnapshot]
	upstreamCostQueue        = make(chan upstreamCostPending, upstreamCostQueueSize)
	upstreamCostDropped      atomic.Int64
	upstreamCostBatchMu      sync.Mutex
	upstreamCostBatch        []*model.UpstreamCostRecord
)

// StartUpstreamCostRecorder runs on every node: each node records the consume
// logs of the requests it relays.
func StartUpstreamCostRecorder() {
	upstreamCostRecorderOnce.Do(func() {
		model.SetConsumeLogHook(recordUpstreamCostConsumeLog)
		gopool.Go(runUpstreamCostSnapshotLoop)
		gopool.Go(runUpstreamCostWriterLoop)
	})
}

// FlushUpstreamCostRecords writes queued records during shutdown.
func FlushUpstreamCostRecords() {
	for {
		select {
		case pending := <-upstreamCostQueue:
			appendUpstreamCostRecord(buildUpstreamCostRecord(pending))
		default:
			flushUpstreamCostBatch()
			return
		}
	}
}

func runUpstreamCostSnapshotLoop() {
	ticker := time.NewTicker(upstreamCostSnapshotReload)
	defer ticker.Stop()
	for {
		if upstream_cost_setting.GetSetting().Enabled {
			reloadUpstreamCostSnapshot(false)
		}
		<-ticker.C
	}
}

func runUpstreamCostWriterLoop() {
	ticker := time.NewTicker(upstreamCostFlushInterval)
	defer ticker.Stop()
	for {
		select {
		case pending := <-upstreamCostQueue:
			if appendUpstreamCostRecord(buildUpstreamCostRecord(pending)) {
				flushUpstreamCostBatch()
			}
		case <-ticker.C:
			flushUpstreamCostBatch()
			if dropped := upstreamCostDropped.Swap(0); dropped > 0 {
				common.SysError(fmt.Sprintf("upstream cost recorder queue full, dropped %d records", dropped))
			}
		}
	}
}

// appendUpstreamCostRecord reports whether the batch reached its flush size.
func appendUpstreamCostRecord(record *model.UpstreamCostRecord) bool {
	upstreamCostBatchMu.Lock()
	defer upstreamCostBatchMu.Unlock()
	upstreamCostBatch = append(upstreamCostBatch, record)
	return len(upstreamCostBatch) >= upstreamCostBatchSize
}

func flushUpstreamCostBatch() {
	upstreamCostBatchMu.Lock()
	batch := upstreamCostBatch
	upstreamCostBatch = nil
	upstreamCostBatchMu.Unlock()
	if len(batch) == 0 {
		return
	}
	if err := model.InsertUpstreamCostRecords(batch); err != nil {
		common.SysError(fmt.Sprintf("failed to save %d upstream cost records: %v", len(batch), err))
	}
}

func reloadUpstreamCostSnapshot(force bool) {
	version, err := model.UpstreamCostDataVersion()
	if err != nil {
		common.SysError("failed to check upstream cost data version: " + err.Error())
		return
	}
	if current := upstreamCostSnapshotPtr.Load(); !force && current != nil && current.version == version {
		return
	}
	sites, err := model.GetUpstreamSites()
	if err != nil {
		common.SysError("failed to load upstream sites: " + err.Error())
		return
	}
	monitors, err := model.GetAllUpstreamChannelMonitors()
	if err != nil {
		common.SysError("failed to load upstream channel monitors: " + err.Error())
		return
	}
	upstreamCostSnapshotPtr.Store(buildUpstreamCostSnapshot(version, sites, monitors))
}

func buildUpstreamCostSnapshot(version string, sites []*model.UpstreamSite, monitors []*model.UpstreamChannelMonitor) *upstreamCostSnapshot {
	type siteSnapshot struct {
		site         *model.UpstreamSite
		modelPricing map[string]model.Pricing
	}
	siteById := make(map[int]siteSnapshot, len(sites))
	for _, site := range sites {
		if site.Status != model.UpstreamSiteStatusNewAPI {
			continue
		}
		siteById[site.Id] = siteSnapshot{
			site:         site,
			modelPricing: decodeUpstreamJSON[map[string]model.Pricing](site.ModelPricing),
		}
	}
	snapshot := &upstreamCostSnapshot{
		version:  version,
		channels: make(map[int]*upstreamCostChannelSnapshot, len(monitors)),
	}
	for _, monitor := range monitors {
		site, ok := siteById[monitor.SiteId]
		if !ok || monitor.Mode != model.UpstreamMonitorModeAuto {
			continue
		}
		group := monitor.ManualGroup
		if group == "" {
			group = monitor.DetectedGroup
		}
		snapshot.channels[monitor.ChannelId] = &upstreamCostChannelSnapshot{
			site:         site.site,
			costFactor:   upstreamCostFactor(site.site),
			keys:         decodeUpstreamJSON[map[int]upstreamKeyState](monitor.KeyStates),
			group:        group,
			ratio:        monitor.GroupRatio,
			modelPricing: site.modelPricing,
		}
	}
	return snapshot
}

// recordUpstreamCostConsumeLog runs on the request goroutine right after a
// consume log is stored. It only copies request data and never blocks.
func recordUpstreamCostConsumeLog(c *gin.Context, log *model.Log, other *model.LogOther) {
	if !upstream_cost_setting.GetSetting().Enabled {
		return
	}
	snapshot := upstreamCostSnapshotPtr.Load()
	if snapshot == nil {
		return
	}
	channel, ok := snapshot.channels[log.ChannelId]
	if !ok {
		return
	}
	values := other.Snapshot()
	// Violation fees are local penalties for rejected upstream calls.
	if violation, _ := values["violation_fee"].(bool); violation {
		return
	}
	keyIndex := 0
	if common.GetContextKeyBool(c, constant.ContextKeyChannelIsMultiKey) {
		keyIndex = common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
	}
	upstreamModel := log.ModelName
	if mapped, _ := values["upstream_model_name"].(string); mapped != "" {
		upstreamModel = mapped
	}
	pending := upstreamCostPending{
		record: &model.UpstreamCostRecord{
			RequestId:         log.RequestId,
			UpstreamRequestId: log.UpstreamRequestId,
			CreatedAt:         log.CreatedAt,
			UserId:            log.UserId,
			Username:          log.Username,
			TokenName:         log.TokenName,
			ModelName:         log.ModelName,
			ChannelId:         log.ChannelId,
			UsingGroup:        log.Group,
			Quota:             log.Quota,
			PromptTokens:      log.PromptTokens,
			CompletionTokens:  log.CompletionTokens,
			SiteId:            channel.site.Id,
			KeyIndex:          keyIndex,
		},
		channel:       channel,
		upstreamModel: upstreamModel,
		cacheTokens:   int(logOtherNumber(values["cache_tokens"])),
		localRatio:    logOtherNumber(values["group_ratio"]),
	}
	select {
	case upstreamCostQueue <- pending:
	default:
		upstreamCostDropped.Add(1)
	}
}

// buildUpstreamCostRecord attaches the request-time upstream group ratio and
// an estimated cost; the monitor later replaces the estimate with the exact
// upstream charge when it finds the upstream log.
func buildUpstreamCostRecord(pending upstreamCostPending) *model.UpstreamCostRecord {
	record := pending.record
	channel := pending.channel
	group, ratio := channel.group, channel.ratio
	if key, ok := channel.keys[record.KeyIndex]; ok && key.EffectiveGroup != "" && key.EffectiveRatio > 0 {
		group, ratio = key.EffectiveGroup, key.EffectiveRatio
	}
	record.UpstreamGroup = group
	record.UpstreamGroupRatio = ratio
	usage := upstreamUsage{
		PromptTokens:     record.PromptTokens,
		CompletionTokens: record.CompletionTokens,
		CacheTokens:      pending.cacheTokens,
	}
	if cost, ok := estimateUpstreamCostQuota(channel, pending.upstreamModel, usage, record.Quota, pending.localRatio, ratio); ok {
		record.CostQuota = cost
		record.Status = model.UpstreamCostRecordEstimated
	}
	return record
}

// logOtherNumber reads numeric metadata written through LogOther setters.
func logOtherNumber(value any) float64 {
	switch number := value.(type) {
	case float64:
		return number
	case float32:
		return float64(number)
	case int:
		return float64(number)
	case int64:
		return float64(number)
	case int32:
		return float64(number)
	default:
		return 0
	}
}
