package service

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
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

func (p *RetryParam) routeGroups() ([]string, error) {
	userGroup := common.GetContextKeyString(p.Ctx, constant.ContextKeyUserGroup)
	tokenGroups := common.GetContextKeyStringSlice(p.Ctx, constant.ContextKeyTokenGroups)
	if len(tokenGroups) > 0 {
		return tokenGroups, nil
	}
	if p.TokenGroup == "auto" {
		if len(setting.GetAutoGroups()) == 0 {
			return nil, errors.New("auto groups is not enabled")
		}
		return GetUserAutoGroup(userGroup), nil
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

// AdvanceAfterFailure advances within the current group's retry budget, then
// moves to the next configured group when cross-group retry is enabled.
func (p *RetryParam) AdvanceAfterFailure() bool {
	p.ensureInitialized()
	if p.GetRetry() < common.RetryTimes {
		p.SetRetry(p.GetRetry() + 1)
		return true
	}
	if !common.GetContextKeyBool(p.Ctx, constant.ContextKeyTokenCrossGroupRetry) {
		return false
	}
	groups, err := p.routeGroups()
	if err != nil || p.groupIndex+1 >= len(groups) {
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
	var channel *model.Channel
	var err error
	selectGroup := param.TokenGroup
	userGroup := common.GetContextKeyString(param.Ctx, constant.ContextKeyUserGroup)
	filters := GetChannelConstraints(param.Ctx).Filters

	if param.TokenGroup == "auto" {
		autoGroups := GetRequestAutoGroups(param.Ctx, userGroup)
		if len(autoGroups) == 0 {
			return nil, selectGroup, errors.New("auto groups is not enabled")
		}

		// startGroupIndex: the group index to start searching from
		// startGroupIndex: 开始搜索的分组索引
		startGroupIndex := 0
		crossGroupRetry := common.GetContextKeyBool(param.Ctx, constant.ContextKeyTokenCrossGroupRetry)

		if lastGroupIndex, exists := common.GetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex); exists {
			if idx, ok := lastGroupIndex.(int); ok {
				startGroupIndex = idx
			}
		}

		for i := startGroupIndex; i < len(autoGroups); i++ {
			autoGroup := autoGroups[i]
			// Calculate priorityRetry for current group
			// 计算当前分组的 priorityRetry
			priorityRetry := param.GetRetry()
			// If moved to a new group, reset priorityRetry and update startRetryIndex
			// 如果切换到新分组，重置 priorityRetry 并更新 startRetryIndex
			if i > startGroupIndex {
				priorityRetry = 0
			}
			logger.LogDebug(param.Ctx, "Auto selecting group: %s, priorityRetry: %d", autoGroup, priorityRetry)

			channel, _ = model.GetRandomSatisfiedChannel(
				autoGroup,
				param.ModelName,
				priorityRetry,
				filters,
			)
			if channel == nil {
				// Current group has no available channel for this model, try next group
				// 当前分组没有该模型的可用渠道，尝试下一个分组
				logger.LogDebug(param.Ctx, "No available channel in group %s for model %s at priorityRetry %d, trying next group", autoGroup, param.ModelName, priorityRetry)
				// 重置状态以尝试下一个分组
				common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i+1)
				common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupRetryIndex, 0)
				// Reset retry counter so outer loop can continue for next group
				// 重置重试计数器，以便外层循环可以为下一个分组继续
				param.SetRetry(0)
				continue
			}
			common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroup, autoGroup)
			selectGroup = autoGroup
			logger.LogDebug(param.Ctx, "Auto selected group: %s", autoGroup)

			// Prepare state for next retry
			// 为下一次重试准备状态
			if crossGroupRetry && priorityRetry >= common.RetryTimes {
				// Current group has exhausted all retries, prepare to switch to next group
				// This request still uses current group, but next retry will use next group
				// 当前分组已用完所有重试次数，准备切换到下一个分组
				// 本次请求仍使用当前分组，但下次重试将使用下一个分组
				logger.LogDebug(param.Ctx, "Current group %s retries exhausted (priorityRetry=%d >= RetryTimes=%d), preparing switch to next group for next retry", autoGroup, priorityRetry, common.RetryTimes)
				common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i+1)
				// Reset retry counter so outer loop can continue for next group
				// 重置重试计数器，以便外层循环可以为下一个分组继续
				param.SetRetry(0)
				param.ResetRetryNextTry()
			} else {
				// Stay in current group, save current state
				// 保持在当前分组，保存当前状态
				common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i)
			}
			break
		}
	} else {
		channel, err = model.GetRandomSatisfiedChannel(
			param.TokenGroup,
			param.ModelName,
			param.GetRetry(),
			filters,
		)
		if err != nil {
			return nil, param.TokenGroup, err
		}
	}
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

		channel, selectErr := model.GetRandomSatisfiedChannel(group, param.ModelName, retry, param.RequestPath)
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
