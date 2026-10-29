package model

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"

	"gorm.io/gorm"
)

func applyExplicitLogTextFilter(tx *gorm.DB, column string, value string) (*gorm.DB, error) {
	if value == "" {
		return tx, nil
	}
	if strings.Contains(value, "%") {
		condition, pattern, err := buildLogLikeCondition(column, value)
		if err != nil {
			return nil, err
		}
		return tx.Where(condition, pattern), nil
	}
	return tx.Where(column+" = ?", value), nil
}

func buildLogLikeCondition(column string, value string) (string, string, error) {
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		pattern, err := sanitizeClickHouseLikePattern(value)
		if err != nil {
			return "", "", err
		}
		return column + " LIKE ?", pattern, nil
	}

	pattern, err := sanitizeLikePattern(value)
	if err != nil {
		return "", "", err
	}
	return column + " LIKE ? ESCAPE '!'", pattern, nil
}

func sanitizeClickHouseLikePattern(input string) (string, error) {
	input = strings.ReplaceAll(input, `\`, `\\`)
	input = strings.ReplaceAll(input, `_`, `\_`)

	if err := validateLikePattern(input); err != nil {
		return "", err
	}
	return input, nil
}

type Log struct {
	Id                int    `json:"id" gorm:"index:idx_created_at_id,priority:2;index:idx_user_id_id,priority:2"`
	UserId            int    `json:"user_id" gorm:"index;index:idx_user_id_id,priority:1"`
	CreatedAt         int64  `json:"created_at" gorm:"bigint;index:idx_created_at_id,priority:1;index:idx_created_at_type"`
	Type              int    `json:"type" gorm:"index:idx_created_at_type"`
	Content           string `json:"content"`
	Username          string `json:"username" gorm:"index;index:index_username_model_name,priority:2;default:''"`
	TokenName         string `json:"token_name" gorm:"index;default:''"`
	ModelName         string `json:"model_name" gorm:"index;index:index_username_model_name,priority:1;default:''"`
	Quota             int    `json:"quota" gorm:"default:0"`
	PromptTokens      int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens  int    `json:"completion_tokens" gorm:"default:0"`
	UseTime           int    `json:"use_time" gorm:"default:0"`
	IsStream          bool   `json:"is_stream"`
	ChannelId         int    `json:"channel" gorm:"index"`
	ChannelName       string `json:"channel_name" gorm:"->"`
	TokenId           int    `json:"token_id" gorm:"default:0;index"`
	Group             string `json:"group" gorm:"index"`
	Ip                string `json:"ip" gorm:"index;default:''"`
	RequestId         string `json:"request_id,omitempty" gorm:"type:varchar(64);index:idx_logs_request_id;default:''"`
	UpstreamRequestId string `json:"upstream_request_id,omitempty" gorm:"type:varchar(128);index:idx_logs_upstream_request_id;default:''"`
	Other             string `json:"other"`
}

// don't use iota, avoid change log type value
const (
	LogTypeUnknown = 0
	LogTypeTopup   = 1
	LogTypeConsume = 2
	LogTypeManage  = 3
	LogTypeSystem  = 4
	LogTypeError   = 5
	LogTypeRefund  = 6
	LogTypeLogin   = 7
)

func ensureLogRequestId(log *Log) {
	if log != nil && log.RequestId == "" {
		log.RequestId = common.NewRequestId()
	}
}

func createLog(log *Log) error {
	ensureLogRequestId(log)
	return LOG_DB.Create(log).Error
}

func clickHouseLogOrder(prefix string) string {
	return prefix + "created_at desc, " + prefix + "request_id desc"
}

func assignDisplayLogIds(logs []*Log, startIdx int) {
	for i := range logs {
		logs[i].Id = startIdx + i + 1
	}
}

func formatUserLogs(logs []*Log, startIdx int, role int) {
	visibility := logOtherVisibilityUser
	if role >= common.RoleAdminUser {
		visibility = logOtherVisibilityAdminSelf
	}
	for i := range logs {
		logs[i].ChannelName = ""
		logs[i].Other = formatLogOtherJSON(logs[i].Other, visibility)
	}
	assignDisplayLogIds(logs, startIdx)
}

// FormatAdminLogs removes root-only diagnostics while retaining operational
// admin_info. Root callers must not pass their results through this formatter.
func FormatAdminLogs(logs []*Log) {
	for i := range logs {
		logs[i].Other = formatLogOtherJSON(logs[i].Other, logOtherVisibilityAdmin)
	}
}

// FormatRootLogs normalizes legacy metadata into the current scoped shape
// without removing root-only diagnostics.
func FormatRootLogs(logs []*Log) {
	for i := range logs {
		logs[i].Other = formatLogOtherJSON(logs[i].Other, logOtherVisibilityRoot)
	}
}

func GetLogByTokenId(tokenId int) (logs []*Log, err error) {
	order := "id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("")
	}
	err = LOG_DB.Model(&Log{}).Where("token_id = ?", tokenId).Order(order).Limit(common.MaxRecentItems).Find(&logs).Error
	formatUserLogs(logs, 0, common.RoleCommonUser)
	return logs, err
}

func RecordLog(userId int, logType int, content *common.Message) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(userId, false)
	other := NewLogOther()
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   other.setContent([]*common.Message{content}),
		Other:     other.JSONString(),
	}
	err := createLog(log)
	if err != nil {
		common.SysLog(common.LogText("failed to record log: %s", err.Error()))
	}
}

// RecordLogWithAdminInfo stores operator metadata under other.admin_info and
// an optional, user-visible operation descriptor under other.op for localization.
func RecordLogWithAdminInfo(userId int, logType int, content string, adminInfo *AuditAdminInfo, operation *AuditOperation, request ...*gin.Context) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(userId, false)
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	if logType == LogTypeManage {
		var c *gin.Context
		if len(request) > 0 {
			c = request[0]
		}
		actorRole := 0
		if c != nil {
			actorRole = c.GetInt("role")
		}
		RecordAuditLog(c, AuditLog{UserId: userId, Username: username, ActorRole: actorRole, Category: AuditCategoryOperation, Content: content, Other: AuditOther{AdminInfo: adminInfo, Op: operation}, Success: true})
		return
	}
	if len(request) > 0 && request[0] != nil {
		log.RequestId = request[0].GetString(common.RequestIdKey)
	}
	if adminInfo != nil || operation != nil {
		data, err := common.Marshal(AuditOther{AdminInfo: adminInfo, Op: operation})
		if err != nil {
			common.SysError(common.LogText("failed to encode log admin info: %s", err.Error()))
			return
		}
		log.Other = string(data)
	}
	if err := createLog(log); err != nil {
		common.SysLog(common.LogText("failed to record log: %s", err.Error()))
	}
}

// RecordLoginLog writes new login events to the independent audit table.
// username 由调用方传入（登录流程已持有用户对象），避免额外的数据库查询。
// content 为英文兜底文本（用于导出）；action+params 供前端本地化渲染。
// other 包含 login_method、user_agent 等结构化信息。
func RecordLoginLog(userId, actorRole int, username string, content string, ip string, action string, params map[string]any, other AuditOther, request ...*gin.Context) {
	other.Op = &AuditOperation{Action: action, Params: params}
	var c *gin.Context
	if len(request) > 0 {
		c = request[0]
	}
	RecordAuditLog(c, AuditLog{UserId: userId, Username: username, ActorRole: actorRole, Category: AuditCategoryLogin, Action: action, Content: content, Ip: ip, Other: other, Success: true})
}

// RecordOperationAuditLog writes new operation/security events to the audit table.
// logUserId 为日志归属者，管理审计日志应归属实际操作者；目标资源/用户放入
// action params。username 内部按 logUserId 查询。content 为英文兜底文本（供导出使用）。
// action+params 写入 Other.op，供前端本地化渲染（普通用户可见，不含敏感信息）。
// adminInfo 存放操作者身份（写入 Other.admin_info，普通用户查询时剥离）；
// auditInfo 存放路由/方法/结果等中间件兜底信息（写入 Other.audit_info，普通用户查询时剥离）。
func RecordOperationAuditLog(logUserId, actorRole int, content string, ip string, action string, params map[string]any, adminInfo *AuditAdminInfo, auditInfo *AuditRequestInfo, request ...*gin.Context) {
	username, _ := GetUsernameById(logUserId, false)
	other := AuditOther{
		Op:        &AuditOperation{Action: action, Params: params},
		AdminInfo: adminInfo,
		AuditInfo: auditInfo,
	}
	var c *gin.Context
	if len(request) > 0 {
		c = request[0]
	}
	category := AuditCategoryOperation
	if adminInfo == nil {
		category = AuditCategorySecurity
	}
	status, success := 200, true
	if auditInfo != nil {
		status = auditInfo.Status
		success = auditInfo.Success
	}
	RecordAuditLog(c, AuditLog{UserId: logUserId, Username: username, ActorRole: actorRole, Category: category, Action: action, Content: content, Ip: ip, Status: status, Success: success, Other: other})
}

func RecordTopupLog(userId int, content *common.Message, callerIp string, paymentMethod string, callbackPaymentMethod string) {
	username, _ := GetUsernameById(userId, false)
	other := NewLogOther()
	other.MergeAdmin(map[string]any{
		"server_ip":               common.GetIp(),
		"node_name":               common.NodeName,
		"caller_ip":               callerIp,
		"payment_method":          paymentMethod,
		"callback_payment_method": callbackPaymentMethod,
		"version":                 common.Version,
	})
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeTopup,
		Content:   other.setContent([]*common.Message{content}),
		Ip:        callerIp,
		Other:     other.JSONString(),
	}
	err := createLog(log)
	if err != nil {
		common.SysLog(common.LogText("failed to record topup log: %s", err.Error()))
	}
}

// attachRequestOrigin 把请求来源信息写入日志的 Other：请求端点与访问地区。
// request_path 已由上游账单信息生成器写入时不覆盖；地区取 CDN 透传的国家码，
// 无法识别时不写该字段。
func attachRequestOrigin(c *gin.Context, other *LogOther) {
	if c == nil || other == nil {
		return
	}
	if path := c.Request.URL.Path; path != "" {
		other.SetPublic("request_path", path)
	}
	if country := common.GetClientCountry(c); country != "" {
		other.SetPublic("region", country)
	}
}

func RecordErrorLog(c *gin.Context, userId int, channelId int, modelName string, tokenName string, content string, tokenId int, useTimeSeconds int,
	isStream bool, group string, other *LogOther) {
	logger.LogInfo(c, common.LogText("record error log: userId=%d, channelId=%d, modelName=%s, tokenName=%s, content=%s", userId, channelId, modelName, tokenName, common.LocalLogPreview(content)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	upstreamRequestId := c.GetString(common.UpstreamRequestIdKey)
	attachRequestOrigin(c, other)
	otherStr := other.JSONString()
	log := &Log{
		UserId:            userId,
		Username:          username,
		CreatedAt:         common.GetTimestamp(),
		Type:              LogTypeError,
		Content:           content,
		PromptTokens:      0,
		CompletionTokens:  0,
		TokenName:         tokenName,
		ModelName:         modelName,
		Quota:             0,
		ChannelId:         channelId,
		TokenId:           tokenId,
		UseTime:           useTimeSeconds,
		IsStream:          isStream,
		Group:             group,
		Ip:                c.ClientIP(),
		RequestId:         requestId,
		UpstreamRequestId: upstreamRequestId,
		Other:             otherStr,
	}
	err := createLog(log)
	if err != nil {
		logger.LogError(c, common.LogText("failed to record log: %s", err.Error()))
	}
}

type RecordConsumeLogParams struct {
	ChannelId        int               `json:"channel_id"`
	PromptTokens     int               `json:"prompt_tokens"`
	CompletionTokens int               `json:"completion_tokens"`
	ModelName        string            `json:"model_name"`
	TokenName        string            `json:"token_name"`
	Quota            int               `json:"quota"`
	Content          []*common.Message `json:"content"`
	TokenId          int               `json:"token_id"`
	UseTimeSeconds   int               `json:"use_time_seconds"`
	IsStream         bool              `json:"is_stream"`
	Group            string            `json:"group"`
	Other            *LogOther         `json:"other"`
}

// ConsumeLogHook observes consume logs after they are stored. It runs on the
// request goroutine, so implementations must return quickly and never block.
type ConsumeLogHook func(c *gin.Context, log *Log, other *LogOther)

var consumeLogHook atomic.Pointer[ConsumeLogHook]

// SetConsumeLogHook lets higher layers observe consume logs without the model
// package importing them.
func SetConsumeLogHook(hook ConsumeLogHook) {
	consumeLogHook.Store(&hook)
}

func RecordConsumeLog(c *gin.Context, userId int, params RecordConsumeLogParams) {
	if !common.LogConsumeEnabled {
		return
	}
	logger.LogInfo(c, common.LogText("record consume log: userId=%d, params=%s", userId, common.GetJsonString(params)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	upstreamRequestId := c.GetString(common.UpstreamRequestIdKey)
	createdAt := common.GetTimestamp()
	attachRequestOrigin(c, params.Other)
	content := params.Other.setContent(params.Content)
	otherStr := params.Other.JSONString()
	log := &Log{
		UserId:            userId,
		Username:          username,
		CreatedAt:         createdAt,
		Type:              LogTypeConsume,
		Content:           content,
		PromptTokens:      params.PromptTokens,
		CompletionTokens:  params.CompletionTokens,
		TokenName:         params.TokenName,
		ModelName:         params.ModelName,
		Quota:             params.Quota,
		ChannelId:         params.ChannelId,
		TokenId:           params.TokenId,
		UseTime:           params.UseTimeSeconds,
		IsStream:          params.IsStream,
		Group:             params.Group,
		Ip:                c.ClientIP(),
		RequestId:         requestId,
		UpstreamRequestId: upstreamRequestId,
		Other:             otherStr,
	}
	err := createLog(log)
	if err != nil {
		logger.LogError(c, common.LogText("failed to record log: %s", err.Error()))
	} else if hook := consumeLogHook.Load(); hook != nil {
		(*hook)(c, log, params.Other)
	}
	if common.DataExportEnabled {
		LogQuotaData(QuotaDataLogParams{
			UserID:    userId,
			Username:  username,
			ModelName: params.ModelName,
			Quota:     params.Quota,
			CreatedAt: createdAt,
			TokenUsed: params.PromptTokens + params.CompletionTokens,
			UseGroup:  params.Group,
			TokenID:   params.TokenId,
			ChannelID: params.ChannelId,
			NodeName:  common.NodeName,
		})
	}
}

type RecordTaskBillingLogParams struct {
	UserId    int
	LogType   int
	Content   []*common.Message
	ChannelId int
	ModelName string
	Quota     int
	TokenId   int
	Group     string
	Other     *LogOther
	NodeName  string // 任务发起节点；为空时回退当前节点
}

func RecordTaskBillingLog(params RecordTaskBillingLogParams) {
	if params.LogType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(params.UserId, false)
	tokenName := ""
	if params.TokenId > 0 {
		if token, err := GetTokenById(params.TokenId); err == nil {
			tokenName = token.Name
		}
	}
	createdAt := common.GetTimestamp()
	other := params.Other
	log := &Log{
		UserId:    params.UserId,
		Username:  username,
		CreatedAt: createdAt,
		Type:      params.LogType,
		Content:   other.setContent(params.Content),
		TokenName: tokenName,
		ModelName: params.ModelName,
		Quota:     params.Quota,
		ChannelId: params.ChannelId,
		TokenId:   params.TokenId,
		Group:     params.Group,
		Other:     other.JSONString(),
	}
	err := createLog(log)
	if err != nil {
		common.SysLog(common.LogText("failed to record task billing log: %s", err.Error()))
	}
	if params.LogType == LogTypeConsume && common.DataExportEnabled {
		nodeName := params.NodeName
		if nodeName == "" {
			nodeName = common.NodeName
		}
		LogQuotaData(QuotaDataLogParams{
			UserID:    params.UserId,
			Username:  username,
			ModelName: params.ModelName,
			Quota:     params.Quota,
			CreatedAt: createdAt,
			UseGroup:  params.Group,
			TokenID:   params.TokenId,
			ChannelID: params.ChannelId,
			NodeName:  nodeName,
		})
	}
}

// LogFilter is the usage-log search shared by the log list, the log export,
// and the log statistics. Username, UserId, TokenId, Channel, and Ip are
// administrator filters.
type LogFilter struct {
	Type              int
	StartTimestamp    int64
	EndTimestamp      int64
	ModelName         string
	Username          string
	UserId            int
	TokenId           int
	TokenName         string
	Channel           int
	Group             string
	RequestId         string
	UpstreamRequestId string
	Ip                string
}

// applyCommon applies every filter except the log type, so statistics that
// always target consume logs can share the exact same search.
func (f LogFilter) applyCommon(tx *gorm.DB) (*gorm.DB, error) {
	var err error
	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", f.ModelName); err != nil {
		return nil, err
	}
	if tx, err = applyExplicitLogTextFilter(tx, "logs.username", f.Username); err != nil {
		return nil, err
	}
	if f.UserId > 0 {
		tx = tx.Where("logs.user_id = ?", f.UserId)
	}
	if f.TokenId > 0 {
		tx = tx.Where("logs.token_id = ?", f.TokenId)
	}
	if f.TokenName != "" {
		tx = tx.Where("logs.token_name = ?", f.TokenName)
	}
	if f.RequestId != "" {
		tx = tx.Where("logs.request_id = ?", f.RequestId)
	}
	if f.UpstreamRequestId != "" {
		tx = tx.Where("logs.upstream_request_id = ?", f.UpstreamRequestId)
	}
	if f.Ip != "" {
		tx = tx.Where("logs.ip = ?", f.Ip)
	}
	if f.StartTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", f.StartTimestamp)
	}
	if f.EndTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", f.EndTimestamp)
	}
	if f.Channel != 0 {
		tx = tx.Where("logs.channel_id = ?", f.Channel)
	}
	if f.Group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", f.Group)
	}
	return tx, nil
}

func (f LogFilter) apply(tx *gorm.DB) (*gorm.DB, error) {
	if f.Type != LogTypeUnknown {
		tx = tx.Where("logs.type = ?", f.Type)
	}
	return f.applyCommon(tx)
}

func GetAllLogs(filter LogFilter, startIdx int, num int) (logs []*Log, total int64, err error) {
	tx, err := filter.apply(LOG_DB)
	if err != nil {
		return nil, 0, err
	}
	err = tx.Model(&Log{}).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}
	order := "logs.created_at desc, logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	err = tx.Order(order).Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		return nil, 0, err
	}
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		assignDisplayLogIds(logs, startIdx)
	}

	channelIds := types.NewSet[int]()
	for _, log := range logs {
		if log.ChannelId != 0 {
			channelIds.Add(log.ChannelId)
		}
	}

	if channelIds.Len() > 0 {
		var channels []struct {
			Id   int    `gorm:"column:id"`
			Name string `gorm:"column:name"`
		}
		if common.MemoryCacheEnabled {
			// Cache get channel
			for _, channelId := range channelIds.Items() {
				if cacheChannel, err := CacheGetChannel(channelId); err == nil {
					channels = append(channels, struct {
						Id   int    `gorm:"column:id"`
						Name string `gorm:"column:name"`
					}{
						Id:   channelId,
						Name: cacheChannel.Name,
					})
				}
			}
		} else {
			// Bulk query channels from DB
			if err = DB.Table("channels").Select("id, name").Where("id IN ?", channelIds.Items()).Find(&channels).Error; err != nil {
				return logs, total, err
			}
		}
		channelMap := make(map[int]string, len(channels))
		for _, channel := range channels {
			channelMap[channel.Id] = channel.Name
		}
		for i := range logs {
			logs[i].ChannelName = channelMap[logs[i].ChannelId]
		}
	}

	return logs, total, err
}

const logSearchCountLimit = 10000

func GetUserLogs(userId int, filter LogFilter, startIdx int, num int, role int) (logs []*Log, total int64, err error) {
	tx, err := filter.apply(LOG_DB.Where("logs.user_id = ?", userId))
	if err != nil {
		return nil, 0, err
	}
	err = tx.Model(&Log{}).Limit(logSearchCountLimit).Count(&total).Error
	if err != nil {
		common.SysError(common.LogText("failed to count user logs: %s", err.Error()))
		return nil, 0, common.NewMessage("Failed to query logs")
	}
	order := "logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	err = tx.Order(order).Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		common.SysError(common.LogText("failed to search user logs: %s", err.Error()))
		return nil, 0, common.NewMessage("Failed to query logs")
	}

	formatUserLogs(logs, startIdx, role)
	return logs, total, err
}

// StreamAllLogs calls fn with each log matching filter, newest first, as an
// administrator with role sees it. Rows are read one at a time, so an export
// never holds the whole result in memory.
func StreamAllLogs(ctx context.Context, filter LogFilter, role int, fn func(*Log) error) error {
	tx, err := filter.apply(LOG_DB.WithContext(ctx))
	if err != nil {
		return err
	}
	visibility := logOtherVisibilityAdmin
	if role >= common.RoleRootUser {
		visibility = logOtherVisibilityRoot
	}
	channelNames := make(map[int]string)
	return streamLogs(tx, "logs.created_at desc, logs.id desc", func(log *Log) error {
		if log.ChannelId != 0 {
			name, ok := channelNames[log.ChannelId]
			if !ok {
				if channel, err := CacheGetChannel(log.ChannelId); err == nil {
					name = channel.Name
				}
				channelNames[log.ChannelId] = name
			}
			log.ChannelName = name
		}
		log.Other = formatLogOtherJSON(log.Other, visibility)
		return fn(log)
	})
}

// StreamUserLogs is StreamAllLogs for one user's own logs, shaped like the
// user log list.
func StreamUserLogs(ctx context.Context, userId int, filter LogFilter, role int, fn func(*Log) error) error {
	tx, err := filter.apply(LOG_DB.WithContext(ctx).Where("logs.user_id = ?", userId))
	if err != nil {
		return err
	}
	visibility := logOtherVisibilityUser
	if role >= common.RoleAdminUser {
		visibility = logOtherVisibilityAdminSelf
	}
	count := 0
	return streamLogs(tx, "logs.id desc", func(log *Log) error {
		count++
		log.Id = count
		log.ChannelName = ""
		log.Other = formatLogOtherJSON(log.Other, visibility)
		return fn(log)
	})
}

func streamLogs(tx *gorm.DB, order string, fn func(*Log) error) error {
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	rows, err := tx.Model(&Log{}).Order(order).Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var log Log
		if err := LOG_DB.ScanRows(rows, &log); err != nil {
			return err
		}
		if err := fn(&log); err != nil {
			return err
		}
	}
	return rows.Err()
}

type Stat struct {
	Quota     int     `json:"quota"`
	Rpm       int     `json:"rpm"`
	Tpm       int     `json:"tpm"`
	CacheRate float64 `json:"cache_rate"`
}

// SumUsedQuota aggregates the consume logs matching filter. The filter's Type
// is ignored because quota is only meaningful for consumption; the same search
// as the log list is applied so the stat badges always describe the listed rows.
func SumUsedQuota(filter LogFilter) (stat Stat, err error) {
	// JSON access on other per dialect. Every parse sits behind parsable;
	// PostgreSQL 9.6 has no non-throwing validity test, so it only parses
	// object-shaped text (the gateway always writes valid JSON). A field
	// counts only when it is a JSON number.
	var parsable, isNumber, cacheValue, semanticValue, falseValue string
	switch common.LogDatabaseType() {
	case common.DatabaseTypeMySQL:
		parsable = `JSON_VALID(other)`
		isNumber = `JSON_TYPE(JSON_EXTRACT(other, '$.%s')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL')`
		cacheValue = `CAST(JSON_UNQUOTE(JSON_EXTRACT(other, '$.cache_tokens')) AS DECIMAL(65, 18))`
		semanticValue = `JSON_UNQUOTE(JSON_EXTRACT(other, '$.usage_semantic'))`
		falseValue = `0`
	case common.DatabaseTypePostgreSQL:
		parsable = `other LIKE '{%'`
		isNumber = `jsonb_typeof(other::jsonb -> '%s') = 'number'`
		cacheValue = `(other::jsonb ->> 'cache_tokens')::double precision`
		semanticValue = `other::jsonb ->> 'usage_semantic'`
		falseValue = `false`
	case common.DatabaseTypeClickHouse:
		parsable = `isValidJSON(other)`
		isNumber = `JSONType(other, '%s') IN ('Int64', 'UInt64', 'Double')`
		cacheValue = `JSONExtractFloat(other, 'cache_tokens')`
		semanticValue = `JSONExtractString(other, 'usage_semantic')`
		falseValue = `0`
	default:
		parsable = `json_valid(other)`
		isNumber = `json_type(other, '$.%s') IN ('integer', 'real')`
		cacheValue = `CAST(json_extract(other, '$.cache_tokens') AS REAL)`
		semanticValue = `json_extract(other, '$.usage_semantic')`
		falseValue = `0`
	}
	cacheRead := fmt.Sprintf(`CASE WHEN %s THEN CASE WHEN %s THEN %s ELSE 0 END ELSE 0 END`, parsable, fmt.Sprintf(isNumber, "cache_tokens"), cacheValue)
	writeFields := make([]string, 0, 3)
	for _, key := range []string{"cache_creation_tokens", "cache_creation_tokens_5m", "cache_creation_tokens_1h"} {
		writeFields = append(writeFields, fmt.Sprintf(isNumber, key))
	}
	hasCacheWrite := fmt.Sprintf(`CASE WHEN %s THEN (%s) ELSE %s END`, parsable, strings.Join(writeFields, " OR "), falseValue)
	// Anthropic prompt_tokens exclude cache reads; OpenAI prompt_tokens are the
	// total input and already include them. Older logs without an explicit
	// semantic retain the cache-write-field fallback.
	anthropicSemantic := fmt.Sprintf(`CASE WHEN %s THEN %s = 'anthropic' ELSE %s END`, parsable, semanticValue, falseValue)
	excludesCacheRead := fmt.Sprintf(`CASE WHEN %s IS NULL THEN %s ELSE %s END`, semanticValue, hasCacheWrite, anthropicSemantic)
	tx := LOG_DB.Table("logs").Select(fmt.Sprintf("quota, prompt_tokens, %s AS cache_read, %s AS excludes_cache_read", cacheRead, excludesCacheRead))

	// 为rpm和tpm创建单独的查询
	rpmTpmQuery := LOG_DB.Table("logs").Select("count(*) rpm, COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) tpm")

	if tx, err = filter.applyCommon(tx); err != nil {
		return stat, err
	}
	if rpmTpmQuery, err = filter.applyCommon(rpmTpmQuery); err != nil {
		return stat, err
	}

	tx = tx.Where("type = ?", LogTypeConsume)
	rpmTpmQuery = rpmTpmQuery.Where("type = ?", LogTypeConsume)

	// 只统计最近60秒的rpm和tpm
	rpmTpmQuery = rpmTpmQuery.Where("created_at >= ?", time.Now().Add(-60*time.Second).Unix())

	// 执行查询
	// Every request with a cache hit weighs the same: average the per-request
	// rates rather than dividing summed tokens, leaving out 0% requests. The
	// explicit zero avoids NULL/NaN when no request hit the cache.
	cacheRate := `CASE WHEN excludes_cache_read THEN CASE WHEN prompt_tokens + cache_read > 0 THEN cache_read / (prompt_tokens + cache_read) ELSE 0 END ` +
		`WHEN prompt_tokens > 0 THEN cache_read / prompt_tokens ELSE 0 END`
	hitRequests := fmt.Sprintf(`sum(CASE WHEN %s > 0 THEN 1 ELSE 0 END)`, cacheRate)
	statQuery := LOG_DB.Table("(?) AS filtered_logs", tx).Select(fmt.Sprintf(
		`COALESCE(sum(quota), 0) quota, CASE WHEN COALESCE(%[1]s, 0) = 0 THEN 0 ELSE sum(%[2]s) / %[1]s END cache_rate`, hitRequests, cacheRate))
	if err := statQuery.Scan(&stat).Error; err != nil {
		common.SysError(common.LogText("failed to query log stat: %s", err.Error()))
		return stat, common.NewMessage("Failed to query statistics")
	}
	var rateStat struct {
		Rpm int
		Tpm int
	}
	if err := rpmTpmQuery.Scan(&rateStat).Error; err != nil {
		common.SysError(common.LogText("failed to query rpm/tpm stat: %s", err.Error()))
		return stat, common.NewMessage("Failed to query statistics")
	}
	stat.Rpm = rateStat.Rpm
	stat.Tpm = rateStat.Tpm

	return stat, nil
}

func SumUsedToken(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string) (token int) {
	tx := LOG_DB.Table("logs").Select("COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0)")
	if username != "" {
		tx = tx.Where("username = ?", username)
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
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	tx.Where("type = ?", LogTypeConsume).Scan(&token)
	return token
}

func CountOldLog(ctx context.Context, targetTimestamp int64) (int64, error) {
	var total int64
	if err := LOG_DB.WithContext(ctx).Model(&Log{}).Where("created_at < ?", targetTimestamp).Count(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

func DeleteOldLogBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if nil != ctx.Err() {
		return 0, ctx.Err()
	}

	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		// ClickHouse DELETE is a heavy mutation that rewrites data parts, so
		// per-batch mutations would be pathologically slow. Remove all matching
		// rows in a single synchronous mutation regardless of limit; the reported
		// count lets the caller's progress loop complete in one pass.
		total, err := CountOldLog(ctx, targetTimestamp)
		if err != nil {
			return 0, err
		}
		if total == 0 {
			return 0, nil
		}
		if err := LOG_DB.WithContext(ctx).Exec(
			"ALTER TABLE logs DELETE WHERE created_at < ? SETTINGS mutations_sync = 1",
			targetTimestamp,
		).Error; err != nil {
			return 0, err
		}
		return total, nil
	}

	result := LOG_DB.WithContext(ctx).Where("created_at < ?", targetTimestamp).Limit(limit).Delete(&Log{})
	if nil != result.Error {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}
