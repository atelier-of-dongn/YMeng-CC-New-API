package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newGroupRetryTestParam(t *testing.T, retryTimes int, crossGroup bool) *RetryParam {
	t.Helper()
	previousRetryTimes := common.RetryTimes
	common.RetryTimes = retryTimes
	t.Cleanup(func() { common.RetryTimes = previousRetryTimes })

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(c, constant.ContextKeyTokenGroups, []string{"a", "b", "c"})
	common.SetContextKey(c, constant.ContextKeyTokenCrossGroupRetry, crossGroup)
	return &RetryParam{Ctx: c, TokenGroup: "a", Retry: common.GetPointer(0)}
}

func TestRetryParamUsesFullBudgetPerGroup(t *testing.T) {
	param := newGroupRetryTestParam(t, 2, true)

	require.True(t, param.AdvanceAfterFailure())
	assert.Equal(t, 1, param.GetRetry())
	require.True(t, param.AdvanceAfterFailure())
	assert.Equal(t, 2, param.GetRetry())
	require.True(t, param.AdvanceAfterFailure())
	assert.Equal(t, 0, param.GetRetry())
	assert.Equal(t, 1, param.groupIndex)

	require.True(t, param.AdvanceAfterFailure())
	require.True(t, param.AdvanceAfterFailure())
	require.True(t, param.AdvanceAfterFailure())
	assert.Equal(t, 2, param.groupIndex)
	require.True(t, param.AdvanceAfterFailure())
	require.True(t, param.AdvanceAfterFailure())
	assert.False(t, param.AdvanceAfterFailure())
}

func TestRetryParamCrossesGroupsWhenRetryTimesIsZero(t *testing.T) {
	param := newGroupRetryTestParam(t, 0, true)

	require.True(t, param.AdvanceAfterFailure())
	assert.Equal(t, 1, param.groupIndex)
	assert.Zero(t, param.GetRetry())
	require.True(t, param.AdvanceAfterFailure())
	assert.Equal(t, 2, param.groupIndex)
	assert.False(t, param.AdvanceAfterFailure())
}

func TestRetryParamStopsAtCurrentGroupWhenCrossGroupRetryDisabled(t *testing.T) {
	param := newGroupRetryTestParam(t, 1, false)

	require.True(t, param.AdvanceAfterFailure())
	assert.Equal(t, 1, param.GetRetry())
	assert.False(t, param.AdvanceAfterFailure())
	assert.Zero(t, param.groupIndex)
}
