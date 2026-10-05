package model

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"gorm.io/gorm"
)

const (
	UpstreamSiteStatusPending     = "pending"
	UpstreamSiteStatusNewAPI      = "newapi"
	UpstreamSiteStatusUnsupported = "unsupported"
	UpstreamSiteStatusUnreachable = "unreachable"
)

const (
	UpstreamPricingStatusOK         = "ok"
	UpstreamPricingStatusGroupsOnly = "groups_only"
	UpstreamPricingStatusError      = "error"
)

const (
	UpstreamMonitorModeAuto   = "auto"
	UpstreamMonitorModeManual = "manual"
	UpstreamMonitorModeOff    = "off"
)

const (
	UpstreamCostStatusNormal       = "normal"
	UpstreamCostStatusRatioChanged = "ratio_changed"
	UpstreamCostStatusInverted     = "inverted"
	UpstreamCostStatusGroupOffline = "group_offline"
	UpstreamCostStatusUnknown      = "unknown"
	UpstreamCostStatusEstimated    = "estimated"
)

const (
	UpstreamCostRecordUnknown   = 0
	UpstreamCostRecordEstimated = 1
	UpstreamCostRecordMatched   = 2
)

// UpstreamSite is a new-api compatible upstream shared by the channels whose
// normalized base URL points at it. GroupStates and ModelPricing hold JSON owned by
// the master monitor; CostFactor is owned by administrators.
type UpstreamSite struct {
	Id               int     `json:"id"`
	BaseURL          string  `json:"base_url" gorm:"type:varchar(191);uniqueIndex"`
	Name             string  `json:"name" gorm:"type:varchar(128)"`
	Version          string  `json:"version" gorm:"type:varchar(64)"`
	Status           string  `json:"status" gorm:"type:varchar(16)"`
	CostFactor       float64 `json:"cost_factor"`
	QuotaPerUnit     float64 `json:"quota_per_unit"`
	QuotaDisplayType string  `json:"quota_display_type" gorm:"type:varchar(16)"`
	USDExchangeRate  float64 `json:"usd_exchange_rate"`
	PricingStatus    string  `json:"pricing_status" gorm:"type:varchar(16)"`
	GroupStates      string  `json:"-" gorm:"type:text"`
	ModelPricing     string  `json:"-" gorm:"type:text"`
	LastError        string  `json:"last_error" gorm:"type:varchar(255)"`
	ProbeNextAt      int64   `json:"probe_next_at"`
	PricingNextAt    int64   `json:"pricing_next_at"`
	PricingFetchedAt int64   `json:"pricing_fetched_at"`
	LogNextAt        int64   `json:"log_next_at"`
	LastLogPollAt    int64   `json:"last_log_poll_at"`
	LogBackoff       int     `json:"log_backoff"`
	CreatedAt        int64   `json:"created_at"`
	UpdatedAt        int64   `json:"updated_at" gorm:"index;autoUpdateTime:milli"`
}

// UpstreamChannelMonitor stores the monitoring state of one channel. Mode and
// ManualGroup are owned by administrators; the remaining state is written only
// by the master monitor.
type UpstreamChannelMonitor struct {
	ChannelId      int      `json:"channel_id" gorm:"primaryKey;autoIncrement:false"`
	SiteId         int      `json:"site_id" gorm:"index"`
	BaseURL        string   `json:"base_url" gorm:"type:varchar(191)"`
	Mode           string   `json:"mode" gorm:"type:varchar(8)"`
	ManualGroup    string   `json:"manual_group" gorm:"type:varchar(64)"`
	ManualRatio    *float64 `json:"manual_ratio"`
	DetectedGroup  string   `json:"detected_group" gorm:"type:varchar(64)"`
	GroupRatio     float64  `json:"group_ratio"`
	PrevGroupRatio float64  `json:"prev_group_ratio"`
	RatioSource    string   `json:"ratio_source" gorm:"type:varchar(8)"`
	RatioChangedAt int64    `json:"ratio_changed_at"`
	CostStatus     string   `json:"cost_status" gorm:"type:varchar(16)"`
	StatusDetail   string   `json:"-" gorm:"type:text"`
	KeyStates      string   `json:"-" gorm:"type:text"`
	AlertState     string   `json:"-" gorm:"type:text"`
	UpdatedAt      int64    `json:"updated_at" gorm:"index;autoUpdateTime:milli"`
}

// UpstreamCostRecord mirrors one consume log of a monitored channel together
// with its upstream cost. It lives in the main database because LOG_DB may be
// ClickHouse, whose logs have no stable id and no column migration path.
type UpstreamCostRecord struct {
	Id                 int     `json:"id"`
	RequestId          string  `json:"request_id" gorm:"type:varchar(64);index"`
	UpstreamRequestId  string  `json:"upstream_request_id" gorm:"type:varchar(128);index"`
	CreatedAt          int64   `json:"created_at" gorm:"index;index:idx_upstream_cost_site_status,priority:3"`
	UserId             int     `json:"user_id"`
	Username           string  `json:"username" gorm:"type:varchar(191)"`
	TokenName          string  `json:"token_name" gorm:"type:varchar(191)"`
	ModelName          string  `json:"model_name" gorm:"type:varchar(191)"`
	ChannelId          int     `json:"channel_id" gorm:"index"`
	UsingGroup         string  `json:"using_group" gorm:"type:varchar(64)"`
	Quota              int     `json:"quota"`
	PromptTokens       int     `json:"prompt_tokens"`
	CompletionTokens   int     `json:"completion_tokens"`
	SiteId             int     `json:"site_id" gorm:"index:idx_upstream_cost_site_status,priority:1"`
	KeyIndex           int     `json:"key_index"`
	UpstreamGroup      string  `json:"upstream_group" gorm:"type:varchar(64)"`
	UpstreamGroupRatio float64 `json:"upstream_group_ratio"`
	UpstreamQuota      int     `json:"upstream_quota"`
	CostQuota          int     `json:"cost_quota"`
	Status             int     `json:"status" gorm:"index:idx_upstream_cost_site_status,priority:2"`
}

type UpstreamCostPendingKey struct {
	ChannelId int
	KeyIndex  int
}

type UpstreamCostStat struct {
	Revenue   int64 `json:"revenue"`
	Cost      int64 `json:"cost"`
	Matched   int64 `json:"matched"`
	Estimated int64 `json:"estimated"`
	Unknown   int64 `json:"unknown"`
}

func GetUpstreamSites() ([]*UpstreamSite, error) {
	var sites []*UpstreamSite
	err := DB.Order("id asc").Find(&sites).Error
	return sites, err
}

func GetUpstreamSiteById(id int) (*UpstreamSite, error) {
	site := &UpstreamSite{}
	if err := DB.First(site, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return site, nil
}

// GetOrCreateUpstreamSite tolerates another node creating the same base URL
// between the lookup and the insert.
func GetOrCreateUpstreamSite(baseURL string) (*UpstreamSite, error) {
	site := &UpstreamSite{}
	err := DB.Where("base_url = ?", baseURL).First(site).Error
	if err == nil {
		return site, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	site = &UpstreamSite{
		BaseURL:    baseURL,
		Status:     UpstreamSiteStatusPending,
		CostFactor: 1,
	}
	if createErr := DB.Create(site).Error; createErr != nil {
		existing := &UpstreamSite{}
		if findErr := DB.Where("base_url = ?", baseURL).First(existing).Error; findErr == nil {
			return existing, nil
		}
		return nil, createErr
	}
	return site, nil
}

func UpdateUpstreamSite(id int, fields map[string]any) error {
	return DB.Model(&UpstreamSite{}).Where("id = ?", id).Updates(fields).Error
}

// ResetUpstreamSiteSchedules makes the monitor probe and refresh the given site
// (or every site when siteId is 0) on its next tick.
func ResetUpstreamSiteSchedules(siteId int) error {
	tx := DB.Model(&UpstreamSite{})
	if siteId > 0 {
		tx = tx.Where("id = ?", siteId)
	} else {
		tx = tx.Where("id > ?", 0)
	}
	return tx.Updates(map[string]any{"probe_next_at": 0, "pricing_next_at": 0}).Error
}

func DeleteUpstreamSites(ids []int) error {
	if len(ids) == 0 {
		return nil
	}
	return DB.Where("id IN ?", ids).Delete(&UpstreamSite{}).Error
}

func GetAllUpstreamChannelMonitors() ([]*UpstreamChannelMonitor, error) {
	var monitors []*UpstreamChannelMonitor
	err := DB.Order("channel_id asc").Find(&monitors).Error
	return monitors, err
}

func GetUpstreamChannelMonitors(channelIds []int) ([]*UpstreamChannelMonitor, error) {
	var monitors []*UpstreamChannelMonitor
	if len(channelIds) == 0 {
		return monitors, nil
	}
	err := DB.Where("channel_id IN ?", channelIds).Find(&monitors).Error
	return monitors, err
}

func GetUpstreamChannelMonitor(channelId int) (*UpstreamChannelMonitor, error) {
	monitor := &UpstreamChannelMonitor{}
	if err := DB.First(monitor, "channel_id = ?", channelId).Error; err != nil {
		return nil, err
	}
	return monitor, nil
}

func CreateUpstreamChannelMonitor(monitor *UpstreamChannelMonitor) error {
	return DB.Create(monitor).Error
}

func UpdateUpstreamChannelMonitor(channelId int, fields map[string]any) error {
	return DB.Model(&UpstreamChannelMonitor{}).Where("channel_id = ?", channelId).Updates(fields).Error
}

func DeleteUpstreamChannelMonitors(channelIds []int) error {
	if len(channelIds) == 0 {
		return nil
	}
	return DB.Where("channel_id IN ?", channelIds).Delete(&UpstreamChannelMonitor{}).Error
}

// UpstreamCostDataVersion changes whenever a site or monitor row is inserted,
// updated or deleted, so every node can cheaply decide whether to reload its
// recorder snapshot.
func UpstreamCostDataVersion() (string, error) {
	type tableVersion struct {
		RowCount   int64
		MaxUpdated int64
	}
	var sites, monitors tableVersion
	query := "COUNT(*) AS row_count, COALESCE(MAX(updated_at), 0) AS max_updated"
	if err := DB.Model(&UpstreamSite{}).Select(query).Scan(&sites).Error; err != nil {
		return "", err
	}
	if err := DB.Model(&UpstreamChannelMonitor{}).Select(query).Scan(&monitors).Error; err != nil {
		return "", err
	}
	return fmt.Sprintf("%d:%d:%d:%d", sites.RowCount, sites.MaxUpdated, monitors.RowCount, monitors.MaxUpdated), nil
}

func InsertUpstreamCostRecords(records []*UpstreamCostRecord) error {
	if len(records) == 0 {
		return nil
	}
	return DB.CreateInBatches(records, 200).Error
}

// GetUnmatchedUpstreamCostRecords returns records of a site that still wait for
// an upstream log carrying one of the given upstream request ids.
func GetUnmatchedUpstreamCostRecords(siteId int, upstreamRequestIds []string) ([]*UpstreamCostRecord, error) {
	var records []*UpstreamCostRecord
	for chunk := range slices.Chunk(upstreamRequestIds, 500) {
		var part []*UpstreamCostRecord
		err := DB.Where("site_id = ? AND status <> ? AND upstream_request_id IN ?", siteId, UpstreamCostRecordMatched, chunk).
			Find(&part).Error
		if err != nil {
			return nil, err
		}
		records = append(records, part...)
	}
	return records, nil
}

func UpdateUpstreamCostRecord(id int, fields map[string]any) error {
	return DB.Model(&UpstreamCostRecord{}).Where("id = ?", id).Updates(fields).Error
}

// GetUpstreamCostPendingKeys lists the channel keys whose records created since
// the given time still wait for an exact upstream match.
func GetUpstreamCostPendingKeys(siteId int, since int64) ([]UpstreamCostPendingKey, error) {
	var keys []UpstreamCostPendingKey
	err := DB.Model(&UpstreamCostRecord{}).
		Select("channel_id, key_index").
		Where("site_id = ? AND status <> ? AND upstream_request_id <> ? AND created_at >= ?", siteId, UpstreamCostRecordMatched, "", since).
		Group("channel_id, key_index").
		Scan(&keys).Error
	return keys, err
}

func GetUpstreamCostRecordsByRequestIds(requestIds []string) ([]*UpstreamCostRecord, error) {
	var records []*UpstreamCostRecord
	if len(requestIds) == 0 {
		return records, nil
	}
	err := DB.Where("request_id IN ?", requestIds).Find(&records).Error
	return records, err
}

// SumUpstreamCost aggregates records with the same filters as SumUsedQuota.
// Revenue and cost only cover records whose upstream cost is known.
func SumUpstreamCost(startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, channel int, group string) (UpstreamCostStat, error) {
	stat := UpstreamCostStat{}
	tx := DB.Model(&UpstreamCostRecord{}).
		Select("status, COUNT(*) AS record_count, COALESCE(SUM(quota), 0) AS quota_sum, COALESCE(SUM(cost_quota), 0) AS cost_sum")
	var err error
	if tx, err = applyUpstreamCostTextFilter(tx, "username", username); err != nil {
		return stat, err
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if tx, err = applyUpstreamCostTextFilter(tx, "model_name", modelName); err != nil {
		return stat, err
	}
	if channel != 0 {
		tx = tx.Where("channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where("using_group = ?", group)
	}
	var rows []struct {
		Status      int
		RecordCount int64
		QuotaSum    int64
		CostSum     int64
	}
	if err := tx.Group("status").Scan(&rows).Error; err != nil {
		return stat, err
	}
	for _, row := range rows {
		switch row.Status {
		case UpstreamCostRecordMatched:
			stat.Matched += row.RecordCount
		case UpstreamCostRecordEstimated:
			stat.Estimated += row.RecordCount
		default:
			stat.Unknown += row.RecordCount
			continue
		}
		stat.Revenue += row.QuotaSum
		stat.Cost += row.CostSum
	}
	return stat, nil
}

// applyUpstreamCostTextFilter mirrors applyExplicitLogTextFilter for the main
// database, whose LIKE escaping never follows the ClickHouse log database.
func applyUpstreamCostTextFilter(tx *gorm.DB, column string, value string) (*gorm.DB, error) {
	if value == "" {
		return tx, nil
	}
	if !strings.Contains(value, "%") {
		return tx.Where(column+" = ?", value), nil
	}
	pattern, err := sanitizeLikePattern(value)
	if err != nil {
		return nil, err
	}
	return tx.Where(column+" LIKE ? ESCAPE '!'", pattern), nil
}

// DeleteOldUpstreamCostRecords deletes at most limit records created before the
// given time. It selects ids first because PostgreSQL has no DELETE ... LIMIT.
func DeleteOldUpstreamCostRecords(before int64, limit int) (int64, error) {
	var ids []int
	err := DB.Model(&UpstreamCostRecord{}).
		Where("created_at < ?", before).
		Order("id asc").
		Limit(limit).
		Pluck("id", &ids).Error
	if err != nil || len(ids) == 0 {
		return 0, err
	}
	result := DB.Where("id IN ?", ids).Delete(&UpstreamCostRecord{})
	return result.RowsAffected, result.Error
}
