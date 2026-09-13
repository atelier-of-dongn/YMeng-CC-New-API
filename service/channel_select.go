package service

import (
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
