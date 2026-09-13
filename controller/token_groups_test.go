package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateTokenGroups(t *testing.T) {
	previousUsableGroups := setting.UserUsableGroups2JSONString()
	previousRatios := ratio_setting.GroupRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatios))
	})

	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"a":"A","b":"B"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"a":1,"b":2}`))

	require.NoError(t, validateTokenGroups("default", []string{"b", "a"}))
	require.ErrorContains(t, validateTokenGroups("default", []string{"a", "a"}), "重复")
	require.ErrorContains(t, validateTokenGroups("default", []string{"auto", "a"}), "auto")
	require.ErrorContains(t, validateTokenGroups("default", []string{"missing", "a"}), "无权访问")
	require.Error(t, validateTokenGroups("default", []string{""}))
	require.ErrorContains(t, validateTokenGroups("default", []string{"a"}), "至少")
}

func TestNormalizeTokenRouting(t *testing.T) {
	previousUsableGroups := setting.UserUsableGroups2JSONString()
	previousRatios := ratio_setting.GroupRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatios))
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"a":"A","b":"B"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"a":1,"b":2}`))

	multi := &model.Token{Group: "a", Groups: []string{"b", "a"}, CrossGroupRetry: false}
	require.NoError(t, normalizeTokenRouting("default", multi))
	assert.Equal(t, "b", multi.Group)
	assert.JSONEq(t, `["b","a"]`, multi.GroupSequence)
	assert.True(t, multi.CrossGroupRetry)

	single := &model.Token{Group: "a", Groups: []string{}, GroupSequence: `["a","b"]`, CrossGroupRetry: true}
	require.NoError(t, normalizeTokenRouting("default", single))
	assert.Equal(t, "a", single.Group)
	assert.Empty(t, single.GroupSequence)
	assert.False(t, single.CrossGroupRetry)

	require.ErrorContains(t, normalizeTokenRouting("default", &model.Token{Group: "auto"}), "auto")
	require.ErrorContains(t, normalizeTokenRouting("default", &model.Token{Groups: []string{"a"}}), "至少")
}
