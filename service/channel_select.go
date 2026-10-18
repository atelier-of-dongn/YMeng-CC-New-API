package service

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

func GetChannelConstraints(c *gin.Context) *dto.ChannelConstraints {
	if c == nil {
		return &dto.ChannelConstraints{}
	}
	if existing, ok := common.GetContextKeyType[*dto.ChannelConstraints](c, constant.ContextKeyChannelConstraints); ok && existing != nil {
		return existing
	}
	constraints := &dto.ChannelConstraints{}
	common.SetContextKey(c, constant.ContextKeyChannelConstraints, constraints)
	return constraints
}

func AppendTaskPluginIdentityFilter(c *gin.Context, pluginKey string) {
	if c == nil {
		return
	}
	channelTypes, pluginKeys := pinnedTaskPluginIdentities(c, pluginKey)
	GetChannelConstraints(c).AddFilter(dto.ChannelFilter{
		Kind:                   dto.FilterTaskPluginIdentity,
		TaskPluginKey:          pluginKey,
		TaskPluginChannelTypes: channelTypes,
		TaskPluginKeys:         pluginKeys,
	})
}

type RetryParam struct {
	Ctx         *gin.Context
	TokenGroup  string
	ModelName   string
	RequestPath string
	Retry       *int

	groupIndex  int
	initialized bool
}

func (p *RetryParam) GetRetry() int {
	if p.Retry == nil {
		return 0
	}
	return *p.Retry
}

func (p *RetryParam) SetRetry(retry int) {
	p.Retry = &retry
}

func (p *RetryParam) IncreaseRetry() {
	p.SetRetry(p.GetRetry() + 1)
}

func (p *RetryParam) routeGroups() ([]string, error) {
	userGroup := common.GetContextKeyString(p.Ctx, constant.ContextKeyUserGroup)
	tokenGroups := common.GetContextKeyStringSlice(p.Ctx, constant.ContextKeyTokenGroups)
	if len(tokenGroups) > 0 {
		return tokenGroups, nil
	}
	if p.TokenGroup == "auto" {
		return GetRequestAutoGroups(p.Ctx, userGroup), nil
	}
	return GetTokenRouteGroups(userGroup, p.TokenGroup, nil), nil
}

func (p *RetryParam) ensureInitialized() {
	if p.initialized {
		return
	}
	p.initialized = true
	if index, ok := common.GetContextKey(p.Ctx, constant.ContextKeyTokenGroupIndex); ok {
		if value, valid := index.(int); valid && value >= 0 {
			p.groupIndex = value
		}
	}
}

func (p *RetryParam) canMoveToNextGroup() bool {
	if !common.GetContextKeyBool(p.Ctx, constant.ContextKeyTokenCrossGroupRetry) {
		return false
	}
	groups, err := p.routeGroups()
	return err == nil && p.groupIndex+1 < len(groups)
}

// RemainingRetryBudget reports how many further attempts may follow a failure:
// the current group's remaining retries, or one when the request can still
// fall back to the next configured group.
func (p *RetryParam) RemainingRetryBudget() int {
	p.ensureInitialized()
	if remaining := common.RetryTimes - p.GetRetry(); remaining > 0 {
		return remaining
	}
	if p.canMoveToNextGroup() {
		return 1
	}
	return 0
}

// AdvanceAfterFailure advances within the current group's retry budget, then
// moves to the next configured group when cross-group retry is enabled.
func (p *RetryParam) AdvanceAfterFailure() bool {
	p.ensureInitialized()
	if p.GetRetry() < common.RetryTimes {
		p.SetRetry(p.GetRetry() + 1)
		return true
	}
	if !p.canMoveToNextGroup() {
		return false
	}
	p.groupIndex++
	p.SetRetry(0)
	common.SetContextKey(p.Ctx, constant.ContextKeyTokenGroupIndex, p.groupIndex)
	return true
}

// CacheGetRandomSatisfiedChannel selects a channel from the ordered token
// group route. Groups without a usable channel for the model/path are skipped
// without consuming an upstream attempt.
func CacheGetRandomSatisfiedChannel(param *RetryParam) (*model.Channel, string, error) {
	param.ensureInitialized()
	filters := GetChannelConstraints(param.Ctx).Filters
	groups, routeErr := param.routeGroups()
	if routeErr != nil {
		return nil, param.TokenGroup, routeErr
	}
	if len(groups) == 0 {
		return nil, param.TokenGroup, nil
	}
	startIndex := param.groupIndex
	for index := startIndex; index < len(groups); index++ {
		group := groups[index]
		retry := param.GetRetry()
		if index != startIndex {
			retry = 0
			param.SetRetry(0)
		}
		logger.LogDebug(param.Ctx, "Selecting group %s at retry %d", group, retry)

		channel, selectErr := model.GetRandomSatisfiedChannel(group, param.ModelName, retry, filters)
		if selectErr != nil {
			return nil, group, selectErr
		}
		if channel == nil {
			logger.LogDebug(param.Ctx, "No available channel in group %s for model %s at retry %d", group, param.ModelName, retry)
			if retry > 0 && !common.GetContextKeyBool(param.Ctx, constant.ContextKeyTokenCrossGroupRetry) {
				return nil, group, nil
			}
			param.groupIndex = index + 1
			common.SetContextKey(param.Ctx, constant.ContextKeyTokenGroupIndex, param.groupIndex)
			continue
		}

		param.groupIndex = index
		common.SetContextKey(param.Ctx, constant.ContextKeyTokenGroupIndex, index)
		common.SetContextKey(param.Ctx, constant.ContextKeySelectedGroup, group)
		common.SetContextKey(param.Ctx, constant.ContextKeyUsingGroup, group)
		// Keep the legacy key populated for existing pricing and override paths.
		common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroup, group)
		return channel, group, nil
	}
	return nil, groups[len(groups)-1], nil
}

func pinnedTaskPluginIdentities(c *gin.Context, expected string) ([]int, []string) {
	if c == nil || expected == "" {
		return nil, nil
	}
	if value, exists := c.Get(jsplugin.ContextKeyPinnedEndpoint); exists {
		pinned, ok := value.(jsplugin.PinnedEndpoint)
		if ok && pinned.Generation != nil && len(pinned.Candidates) > 1 {
			expectedFound := false
			channelTypes := make([]int, 0, len(pinned.Candidates))
			pluginKeys := make([]string, 0, len(pinned.Candidates))
			seen := make(map[int]struct{}, len(pinned.Candidates))
			for _, candidate := range pinned.Candidates {
				if candidate.Plugin == nil {
					continue
				}
				if candidate.Plugin.Meta.Key == expected {
					expectedFound = true
				}
				pluginKeys = append(pluginKeys, candidate.Plugin.Meta.Key)
				for _, channelType := range candidate.Plugin.Meta.ChannelTypes {
					if channelType == 0 || channelType == constant.ChannelTypeTaskPlugin {
						continue
					}
					if _, duplicate := seen[channelType]; duplicate {
						continue
					}
					if plugin, indexed := pinned.Generation.GetByChannelType(channelType); indexed && plugin == candidate.Plugin {
						seen[channelType] = struct{}{}
						channelTypes = append(channelTypes, channelType)
					}
				}
			}
			if expectedFound {
				return channelTypes, pluginKeys
			}
		}
	}
	value, exists := c.Get(jsplugin.ContextKeyPinnedPlugin)
	pinned, ok := value.(jsplugin.PinnedPlugin)
	if !exists || !ok || pinned.Generation == nil || pinned.Plugin == nil || pinned.Plugin.Meta.Key != expected {
		return nil, nil
	}
	channelTypes := make([]int, 0, len(pinned.Plugin.Meta.ChannelTypes))
	for _, channelType := range pinned.Plugin.Meta.ChannelTypes {
		if channelType == 0 || channelType == constant.ChannelTypeTaskPlugin {
			continue
		}
		channelTypes = append(channelTypes, channelType)
	}
	return channelTypes, []string{expected}
}

// ChannelSelectError explains why SelectChannelForRequest found no channel.
// Callers render it for their transport: the HTTP distributor localizes
// MessageID with its own helpers and the Responses WebSocket relay wraps it in
// a NewAPIError. Message is set instead of MessageID when the text is a fixed
// error code that clients match on.
type ChannelSelectError struct {
	StatusCode int
	Code       types.ErrorCode
	MessageID  string
	Params     map[string]any
	Message    string
	// FilterKind and Channel identify a candidate rejected by request filters.
	FilterKind dto.ChannelFilterKind
	Channel    *model.Channel
	// NoAvailableChannel marks the "no channel for this group and model"
	// outcome so the distributor can name the claiming task plugin.
	NoAvailableChannel bool
}

// SelectChannelForRequest resolves the channel for one attempt with the rules
// shared by the HTTP distributor and the Responses WebSocket relay: a pinned
// channel wins, then session affinity (first attempt only), then a random
// eligible channel; every candidate must satisfy the request's channel
// filters. The group the channel was chosen from is returned for auto-group
// callers. The caller still applies SetupContextForSelectedChannel.
func SelectChannelForRequest(c *gin.Context, modelName string, retry *RetryParam) (*model.Channel, string, *ChannelSelectError) {
	constraints := GetChannelConstraints(c)
	if pin, found, overridden := constraints.ResolvedPin(); found {
		for _, lost := range overridden {
			logger.LogWarn(c, common.LogText(
				"channel pin overridden: winning_source=%s winning_channel_id=%d overridden_source=%s overridden_channel_id=%d",
				pin.Source, pin.ChannelId, lost.Source, lost.ChannelId,
			))
		}
		channel, err := model.CacheGetChannel(pin.ChannelId)
		if err != nil {
			return nil, "", pinnedChannelUnavailable(pin, http.StatusBadRequest, i18n.MsgDistributorInvalidChannelId)
		}
		if channel.Status != common.ChannelStatusEnabled {
			return nil, "", pinnedChannelUnavailable(pin, http.StatusForbidden, i18n.MsgDistributorChannelDisabled)
		}
		if ok, kind := model.ChannelSatisfiesFilters(channel, modelName, constraints.Filters); !ok {
			return nil, "", &ChannelSelectError{
				StatusCode: http.StatusBadRequest, Code: types.ErrorCode(kind), MessageID: i18n.MsgDistributorNoAvailableChannel,
				Params:     map[string]any{"Group": common.GetContextKeyString(c, constant.ContextKeyUsingGroup), "Model": modelName},
				FilterKind: kind, Channel: channel,
			}
		}
		return channel, "", nil
	}

	usingGroup := retry.TokenGroup
	var channel *model.Channel
	var selectGroup string
	if retry.GetRetry() == 0 {
		if preferredChannelID, found := GetPreferredChannelByAffinity(c, modelName, usingGroup); found {
			affinityUsable := false
			preferred, err := model.CacheGetChannel(preferredChannelID)
			affinitySatisfied := false
			if err == nil && preferred != nil && preferred.Status == common.ChannelStatusEnabled {
				affinitySatisfied, _ = model.ChannelSatisfiesFilters(preferred, modelName, constraints.Filters)
			}
			if affinitySatisfied {
				if usingGroup == "auto" {
					userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
					for _, g := range GetRequestAutoGroups(c, userGroup) {
						if model.IsChannelEnabledForGroupModel(g, modelName, preferred.Id) {
							selectGroup = g
							common.SetContextKey(c, constant.ContextKeyAutoGroup, g)
							common.SetContextKey(c, constant.ContextKeySelectedGroup, g)
							common.SetContextKey(c, constant.ContextKeyUsingGroup, g)
							groups, _ := retry.routeGroups()
							for index, group := range groups {
								if group == g {
									common.SetContextKey(c, constant.ContextKeyTokenGroupIndex, index)
									break
								}
							}
							channel = preferred
							affinityUsable = true
							MarkChannelAffinityUsed(c, g, preferred.Id)
							break
						}
					}
				} else if model.IsChannelEnabledForGroupModel(usingGroup, modelName, preferred.Id) {
					channel = preferred
					selectGroup = usingGroup
					affinityUsable = true
					common.SetContextKey(c, constant.ContextKeyTokenGroupIndex, 0)
					common.SetContextKey(c, constant.ContextKeySelectedGroup, selectGroup)
					common.SetContextKey(c, constant.ContextKeyUsingGroup, selectGroup)
					common.SetContextKey(c, constant.ContextKeyAutoGroup, selectGroup)
					MarkChannelAffinityUsed(c, usingGroup, preferred.Id)
				}
			}
			if !affinityUsable && !ShouldKeepChannelAffinityOnChannelDisabled() {
				ClearCurrentChannelAffinityCache(c)
			}
			if !affinityUsable && RequestPolicy(c).SessionMode == "strict" {
				return nil, "", &ChannelSelectError{StatusCode: http.StatusServiceUnavailable, Message: "strict_session_binding_unavailable"}
			}
		}
	}

	if channel == nil {
		var err error
		channel, selectGroup, err = CacheGetRandomSatisfiedChannel(retry)
		if err != nil {
			showGroup := usingGroup
			if usingGroup == "auto" {
				showGroup = fmt.Sprintf("auto(%s)", selectGroup)
			}
			return nil, selectGroup, &ChannelSelectError{
				StatusCode: http.StatusServiceUnavailable, Code: types.ErrorCodeModelNotFound, MessageID: i18n.MsgDistributorGetChannelFailed,
				Params: map[string]any{"Group": showGroup, "Model": modelName, "Error": err.Error()},
			}
		}
		if channel == nil {
			return nil, selectGroup, &ChannelSelectError{
				StatusCode: http.StatusServiceUnavailable, Code: types.ErrorCodeModelNotFound, MessageID: i18n.MsgDistributorNoAvailableChannel,
				Params: map[string]any{"Group": usingGroup, "Model": modelName}, NoAvailableChannel: true,
			}
		}
	}
	if ok, kind := model.ChannelSatisfiesFilters(channel, modelName, constraints.Filters); !ok {
		return nil, selectGroup, &ChannelSelectError{
			StatusCode: http.StatusServiceUnavailable, Code: types.ErrorCodeModelNotFound, MessageID: i18n.MsgDistributorNoAvailableChannel,
			Params:     map[string]any{"Group": common.GetContextKeyString(c, constant.ContextKeyUsingGroup), "Model": modelName},
			FilterKind: kind, Channel: channel, NoAvailableChannel: true,
		}
	}
	return channel, selectGroup, nil
}

// Origin-task pins report a fixed code so task polling can tell a retired
// channel from a malformed request.
func pinnedChannelUnavailable(pin dto.ChannelPin, statusCode int, messageID string) *ChannelSelectError {
	if pin.Source == dto.PinSourceOriginTask {
		return &ChannelSelectError{StatusCode: http.StatusBadRequest, Code: "origin_task_channel_disabled", Message: "origin_task_channel_disabled"}
	}
	return &ChannelSelectError{StatusCode: statusCode, MessageID: messageID}
}

// AppendUsedChannel records an attempted channel in the request's channel
// trail, which the retry log and the consume log's admin_info both read.
func AppendUsedChannel(c *gin.Context, channelID int) {
	c.Set("use_channel", append(c.GetStringSlice("use_channel"), fmt.Sprintf("%d", channelID)))
}
