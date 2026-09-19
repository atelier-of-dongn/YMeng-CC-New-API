package jiasuseedance

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newJSONContext(t *testing.T, body string) (*gin.Context, *relaycommon.RelayInfo) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	request := httptest.NewRequest(http.MethodPost, "/v1/video/generations", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = request
	return context, &relaycommon.RelayInfo{
		ChannelMeta:   &relaycommon.ChannelMeta{},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{},
	}
}

func TestConvertToRequestPayloadNormalizesLastFrameAndKeepsMaterials(t *testing.T) {
	raw := `{
		"model": "seedance-2.0",
		"prompt": "@角色1在奔跑",
		"duration": 15,
		"ratio": "16:9",
		"resolution": "720p",
		"images": [
			{"url": "https://m.jiasuapi.com/example/first.png", "type": "first_frame"},
			{"url": "https://m.jiasuapi.com/example/end.png", "type": "last_frame"}
		],
		"videos": ["https://m.jiasuapi.com/example/ref.mp4"],
		"materials": [{"type": "audio", "url": "https://m.jiasuapi.com/example/voice.mp3", "name": "角色1"}]
	}`

	payload, err := convertToRequestPayload([]byte(raw), "mapped-seedance")
	require.NoError(t, err)
	require.Equal(t, "mapped-seedance", payload["model"])
	require.Equal(t, float64(15), payload["duration"])
	require.Equal(t, "16:9", payload["ratio"])
	require.Equal(t, "720p", payload["resolution"])

	images, ok := payload["images"].([]any)
	require.True(t, ok)
	require.Len(t, images, 2)
	first, ok := images[0].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "first_frame", first["type"])
	end, ok := images[1].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "end_frame", end["type"])

	videos, ok := payload["videos"].([]any)
	require.True(t, ok)
	require.Equal(t, []any{"https://m.jiasuapi.com/example/ref.mp4"}, videos)
	materials, ok := payload["materials"].([]any)
	require.True(t, ok)
	require.Len(t, materials, 1)
}

func TestConvertToRequestPayloadDefaultsDuration(t *testing.T) {
	payload, err := convertToRequestPayload([]byte(`{"model":"seedance-2.0","prompt":"a cat"}`), "")
	require.NoError(t, err)
	require.Equal(t, DefaultDuration, payload["duration"])

	payload, err = convertToRequestPayload([]byte(`{"model":"seedance-2.0","prompt":"a cat","duration":0}`), "")
	require.NoError(t, err)
	require.Equal(t, DefaultDuration, payload["duration"])
}

func TestValidateRequestRejectsForbiddenFieldsAndAudioWithFrames(t *testing.T) {
	adaptor := &TaskAdaptor{}

	c, info := newJSONContext(t, `{"model":"seedance-2.0","prompt":"a cat","first_frame_url":"https://example.com/a.png"}`)
	taskErr := adaptor.ValidateRequestAndSetAction(c, info)
	require.NotNil(t, taskErr)
	assert.Equal(t, "invalid_request", taskErr.Code)

	c, info = newJSONContext(t, `{
		"model":"seedance-2.0",
		"prompt":"a cat",
		"images":[{"url":"https://example.com/a.png","type":"first_frame"}],
		"audios":["https://example.com/a.mp3"]
	}`)
	taskErr = adaptor.ValidateRequestAndSetAction(c, info)
	require.NotNil(t, taskErr)
	assert.Contains(t, taskErr.Message, "audios cannot be used")
}

func TestValidateRequestAcceptsObjectImages(t *testing.T) {
	adaptor := &TaskAdaptor{}
	c, info := newJSONContext(t, `{
		"model":"seedance-2.0",
		"prompt":"图片中的人物开始跳舞",
		"duration":10,
		"images":[{"type":"first_frame","url":"https://m.jiasuapi.com/example/first.png"}]
	}`)

	taskErr := adaptor.ValidateRequestAndSetAction(c, info)
	require.Nil(t, taskErr)
	require.Equal(t, constant.TaskActionTextToVideo, info.Action)

	req, err := relaycommon.GetTaskRequest(c)
	require.NoError(t, err)
	require.Equal(t, "seedance-2.0", req.Model)
	require.Equal(t, 10, req.Duration)
	require.Equal(t, map[string]float64{"seconds": 10}, adaptor.EstimateBilling(c, info))
}

func TestGetModelListReturnsSeedance2(t *testing.T) {
	adaptor := &TaskAdaptor{}
	require.Equal(t, []string{"seedance-2.0"}, adaptor.GetModelList())
}

func TestParseTaskResultMapsPublicStatusesAndResultURLs(t *testing.T) {
	adaptor := &TaskAdaptor{}

	queued, err := adaptor.ParseTaskResult(nil, nil, []byte(`{"id":"task_1","status":"queued","progress":0}`))
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusQueued, queued.Status)

	done, err := adaptor.ParseTaskResult(nil, nil, []byte(`{
		"id":"task_1",
		"status":"completed",
		"progress":100,
		"result_urls":["https://m.jiasuapi.com/media/xxxx.mp4"]
	}`))
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSuccess, done.Status)
	require.Equal(t, "https://m.jiasuapi.com/media/xxxx.mp4", done.Url)
	require.Equal(t, "100%", done.Progress)

	failed, err := adaptor.ParseTaskResult(nil, nil, []byte(`{"id":"task_1","status":"failed","error":{"message":"upstream failed","code":"generation_failed"}}`))
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusFailure, failed.Status)
	require.Equal(t, "upstream failed", failed.Reason)

	unknown, err := adaptor.ParseTaskResult(nil, nil, []byte(`{"id":"task_1","status":"unknown","progress":0}`))
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusUnknown, unknown.Status)
}

func TestConvertToOpenAIVideoUsesPublicResultURLs(t *testing.T) {
	adaptor := &TaskAdaptor{}
	task := &model.Task{
		TaskID:   "task_public",
		Status:   model.TaskStatusSuccess,
		Progress: "100%",
		Data: []byte(`{
			"id":"task_upstream",
			"model":"seedance-2.0",
			"status":"completed",
			"progress":100,
			"result_urls":["https://m.jiasuapi.com/media/xxxx.mp4"]
		}`),
	}
	task.Properties.OriginModelName = "seedance-2.0"

	body, err := adaptor.ConvertToOpenAIVideo(task)
	require.NoError(t, err)

	var ov map[string]any
	require.NoError(t, common.Unmarshal(body, &ov))
	require.Equal(t, "task_public", ov["id"])
	require.Equal(t, "completed", ov["status"])
	require.Equal(t, []any{"https://m.jiasuapi.com/media/xxxx.mp4"}, ov["result_urls"])
	_, hasDeprecatedURL := ov["url"]
	require.False(t, hasDeprecatedURL)
	_, hasDeprecatedTaskID := ov["task_id"]
	require.False(t, hasDeprecatedTaskID)
}

func TestBuildRequestURLAndFetchTask(t *testing.T) {
	service.InitHttpClient()
	adaptor := &TaskAdaptor{baseURL: "https://ai.jiasuapi.com"}
	submitURL, err := adaptor.BuildRequestURL(&relaycommon.RelayInfo{})
	require.NoError(t, err)
	require.Equal(t, "https://ai.jiasuapi.com/v1/video/generations", submitURL)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodGet, r.Method)
		require.Equal(t, "/v1/videos/tasks/task_upstream", r.URL.Path)
		require.Equal(t, "Bearer sk-test", r.Header.Get("Authorization"))
		require.Equal(t, "application/json", r.Header.Get("Accept"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task_upstream","status":"queued","progress":0}`))
	}))
	defer server.Close()

	resp, err := adaptor.FetchTask(server.URL, "sk-test", &model.Task{PrivateData: model.TaskPrivateData{UpstreamTaskID: "task_upstream"}}, "")
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = resp.Body.Close()
}
