package service

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
)

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
	param.ensureInitialized()
	groups, err := param.routeGroups()
	if err != nil {
		return nil, param.TokenGroup, err
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
