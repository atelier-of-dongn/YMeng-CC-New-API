package router

import (
	"fmt"
	"sort"
	"testing"

	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJiaSuSeedanceUsesHostVideoRoutesWithoutNativeRouteConflicts(t *testing.T) {
	source, err := builtinplugins.Source("jiasu-seedance")
	require.NoError(t, err)
	plugin, err := jsplugin.CompilePlugin(source, jsplugin.Options{Key: "jiasu-seedance"})
	require.NoError(t, err)
	assert.Empty(t, plugin.Meta.Routes)
	require.Len(t, plugin.Meta.Protocols, 1)
	assert.Equal(t, "openai_video", plugin.Meta.Protocols[0].Name)

	engine := gin.New()
	SetTaskPluginProtocolRouter(engine)
	registry := jsplugin.NewRegistry()
	builder := newPluginGenerationBuilder(engine.Routes(), nil, func(*jsplugin.RoutingGeneration, jsplugin.RouteBinding) []gin.HandlerFunc {
		return nil
	})
	require.NoError(t, registry.SetGenerationPreparer(builder.prepare))
	require.NoError(t, registry.ReplaceOverrides([]*jsplugin.LoadedPlugin{plugin}))

	generation := registry.Generation()
	binding, ok := generation.LookupEndpoint("POST", "/v1/videos", "seedance-2.5-101010")
	require.True(t, ok)
	assert.Same(t, plugin, binding.Plugin)
	assert.Empty(t, registry.RoutingErrors())
}

func TestHostProtocolRegistryDrivesProtocolRoutesOnce(t *testing.T) {
	engine := gin.New()
	SetTaskPluginProtocolRouter(engine)

	expected := []string{
		"POST /v1/responses",
		"GET /v1/responses/:response_id",
		"POST /v1/videos",
		"GET /v1/videos/:task_id",
		"GET /v1/videos/:task_id/content",
		"HEAD /v1/videos/:task_id/content",
	}
	actual := make([]string, 0, len(engine.Routes()))
	for _, route := range engine.Routes() {
		actual = append(actual, fmt.Sprintf("%s %s", route.Method, route.Path))
	}
	sort.Strings(expected)
	sort.Strings(actual)
	assert.Equal(t, expected, actual)
}
