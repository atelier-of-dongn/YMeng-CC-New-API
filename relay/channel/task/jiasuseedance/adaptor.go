package jiasuseedance

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	taskdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

const (
	submitPath = "/v1/video/generations"
	fetchPath  = "/v1/videos/tasks"
	rawBodyKey = "jiasu_seedance_raw_body"
)

var forbiddenRequestFields = []string{
	"first_frame_url",
	"end_frame_url",
	"start_frame",
	"end_frame",
	"function_mode",
}

type responseTask struct {
	ID                 string   `json:"id"`
	TaskID             string   `json:"task_id,omitempty"`
	Object             string   `json:"object"`
	Model              string   `json:"model"`
	Status             string   `json:"status"`
	Progress           int      `json:"progress"`
	CreatedAt          int64    `json:"created_at"`
	CompletedAt        int64    `json:"completed_at,omitempty"`
	ExpiresAt          int64    `json:"expires_at,omitempty"`
	Seconds            string   `json:"seconds,omitempty"`
	Size               string   `json:"size,omitempty"`
	RemixedFromVideoID string   `json:"remixed_from_video_id,omitempty"`
	ResultURLs         []string `json:"result_urls,omitempty"`
	Error              *struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *taskdto.TaskError {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	rawBody, err := storage.Bytes()
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}

	var body map[string]any
	if err := common.Unmarshal(rawBody, &body); err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}

	modelName := strings.TrimSpace(asString(body["model"]))
	prompt := strings.TrimSpace(asString(body["prompt"]))
	if modelName == "" {
		return service.TaskErrorWrapperLocal(fmt.Errorf("model field is required"), "missing_model", http.StatusBadRequest)
	}
	if prompt == "" {
		return service.TaskErrorWrapperLocal(fmt.Errorf("prompt is required"), "invalid_request", http.StatusBadRequest)
	}

	duration := parseDuration(body)
	if duration < 0 || duration > relaycommon.MaxTaskDurationSeconds {
		return service.TaskErrorWrapperLocal(
			fmt.Errorf("seconds must be between 1 and %d", relaycommon.MaxTaskDurationSeconds),
			"invalid_seconds",
			http.StatusBadRequest,
		)
	}

	for _, field := range forbiddenRequestFields {
		if _, exists := body[field]; exists {
			return service.TaskErrorWrapperLocal(
				fmt.Errorf("field %s is not supported; use images[].type first_frame/end_frame instead", field),
				"invalid_request",
				http.StatusBadRequest,
			)
		}
	}
	if err := validateFrameTypesAndAudios(body); err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}

	c.Set(rawBodyKey, rawBody)
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt:   prompt,
		Model:    modelName,
		Duration: duration,
		Metadata: body,
	})
	info.Action = constant.TaskActionTextToVideo
	return nil
}

func (a *TaskAdaptor) AdjustBillingOnSubmit(_ *relaycommon.RelayInfo, _ []byte) map[string]float64 {
	return nil
}

func (a *TaskAdaptor) AdjustBillingOnComplete(_ *model.Task, _ *relaycommon.TaskInfo) int {
	return 0
}

func (a *TaskAdaptor) EstimateBilling(c *gin.Context, _ *relaycommon.RelayInfo) map[string]float64 {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	seconds := req.Duration
	if seconds <= 0 {
		seconds = DefaultDuration
	}
	return map[string]float64{"seconds": float64(seconds)}
}

func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return fmt.Sprintf("%s%s", a.baseURL, submitPath), nil
}

func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	rawBody, err := rawRequestBody(c)
	if err != nil {
		return nil, err
	}
	payload, err := convertToRequestPayload(rawBody, info.UpstreamModelName)
	if err != nil {
		return nil, err
	}
	data, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

func (a *TaskAdaptor) ParseResponse(_ *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (*channel.TaskSubmitResponse, *taskdto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}
	_ = resp.Body.Close()

	var dResp responseTask
	if err := common.Unmarshal(responseBody, &dResp); err != nil {
		return nil, service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
	}

	upstreamID := dResp.ID
	if upstreamID == "" {
		upstreamID = dResp.TaskID
	}
	if upstreamID == "" {
		return nil, service.TaskErrorWrapper(fmt.Errorf("task_id is empty"), "invalid_response", http.StatusInternalServerError)
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.CreatedAt = dResp.CreatedAt
	if ov.CreatedAt == 0 {
		ov.CreatedAt = time.Now().Unix()
	}
	ov.Model = info.OriginModelName
	if dResp.Status != "" {
		ov.Status = dResp.Status
	}
	ov.Progress = dResp.Progress
	return &channel.TaskSubmitResponse{
		UpstreamTaskID: upstreamID,
		TaskData:       responseBody,
		ClientResponse: ov,
	}, nil
}

func (a *TaskAdaptor) FetchTask(baseUrl, key string, task *model.Task, proxy string) (*http.Response, error) {
	if task == nil {
		return nil, fmt.Errorf("invalid task")
	}
	taskID := task.GetUpstreamTaskID()
	if taskID == "" {
		return nil, fmt.Errorf("invalid task_id")
	}

	uri := fmt.Sprintf("%s%s/%s", baseUrl, fetchPath, taskID)
	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) GetModelList() []string {
	return ModelList
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}

func (a *TaskAdaptor) ParseTaskResult(_ *model.Task, _ *http.Response, respBody []byte) (*relaycommon.TaskInfo, error) {
	resTask := responseTask{}
	if err := common.Unmarshal(respBody, &resTask); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	taskResult := relaycommon.TaskInfo{Code: 0}
	switch resTask.Status {
	case "queued", "pending":
		taskResult.Status = model.TaskStatusQueued
	case "processing", "in_progress":
		taskResult.Status = model.TaskStatusInProgress
	case "completed":
		taskResult.Status = model.TaskStatusSuccess
		if len(resTask.ResultURLs) > 0 {
			taskResult.Url = resTask.ResultURLs[0]
		}
	case "failed", "cancelled":
		taskResult.Status = model.TaskStatusFailure
		if resTask.Error != nil && resTask.Error.Message != "" {
			taskResult.Reason = resTask.Error.Message
		} else {
			taskResult.Reason = "task failed"
		}
	case "unknown":
		taskResult.Status = model.TaskStatusUnknown
	default:
		taskResult.Status = model.TaskStatusInProgress
	}
	if resTask.Progress > 0 {
		taskResult.Progress = fmt.Sprintf("%d%%", resTask.Progress)
	}
	return &taskResult, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(originTask *model.Task) ([]byte, error) {
	var dResp responseTask
	if err := common.Unmarshal(originTask.Data, &dResp); err != nil {
		return nil, errors.Wrap(err, "unmarshal jiasu seedance task data failed")
	}

	openAIVideo := dto.NewOpenAIVideo()
	openAIVideo.ID = originTask.TaskID
	openAIVideo.Status = originTask.Status.ToVideoStatus()
	openAIVideo.SetProgressStr(originTask.Progress)
	openAIVideo.CreatedAt = originTask.CreatedAt
	openAIVideo.CompletedAt = originTask.UpdatedAt
	openAIVideo.Model = originTask.Properties.OriginModelName
	if dResp.Model != "" && openAIVideo.Model == "" {
		openAIVideo.Model = dResp.Model
	}
	openAIVideo.Seconds = dResp.Seconds
	openAIVideo.Size = dResp.Size
	openAIVideo.ExpiresAt = dResp.ExpiresAt
	openAIVideo.RemixedFromVideoID = dResp.RemixedFromVideoID
	openAIVideo.Metadata = dResp.Metadata
	if len(dResp.ResultURLs) > 0 {
		openAIVideo.ResultURLs = dResp.ResultURLs
	} else if resultURL := originTask.GetResultURL(); resultURL != "" {
		openAIVideo.ResultURLs = []string{resultURL}
	}
	if dResp.Error != nil {
		openAIVideo.Error = &dto.OpenAIVideoError{
			Message: dResp.Error.Message,
			Code:    dResp.Error.Code,
		}
	}
	return common.Marshal(openAIVideo)
}

func rawRequestBody(c *gin.Context) ([]byte, error) {
	if raw, exists := c.Get(rawBodyKey); exists {
		if body, ok := raw.([]byte); ok {
			return body, nil
		}
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil, errors.Wrap(err, "get_request_body_failed")
	}
	return storage.Bytes()
}

func convertToRequestPayload(rawBody []byte, upstreamModel string) (map[string]any, error) {
	var body map[string]any
	if err := common.Unmarshal(rawBody, &body); err != nil {
		return nil, errors.Wrap(err, "unmarshal request body failed")
	}
	if upstreamModel != "" {
		body["model"] = upstreamModel
	}
	if intFromAny(body["duration"]) <= 0 {
		body["duration"] = DefaultDuration
	}
	if images, ok := body["images"]; ok {
		normalized, err := normalizeImages(images)
		if err != nil {
			return nil, err
		}
		body["images"] = normalized
	}
	return body, nil
}

func normalizeImages(raw any) (any, error) {
	items, ok := raw.([]any)
	if !ok {
		return raw, nil
	}
	out := make([]any, 0, len(items))
	for _, item := range items {
		switch v := item.(type) {
		case string:
			out = append(out, v)
		case map[string]any:
			if imageType, ok := v["type"].(string); ok {
				normalized := normalizeFrameType(imageType)
				if normalized == "" && imageType != "" {
					return nil, fmt.Errorf("invalid images[].type: %s", imageType)
				}
				if normalized != "" {
					v["type"] = normalized
				}
			}
			out = append(out, v)
		default:
			out = append(out, item)
		}
	}
	return out, nil
}

func normalizeFrameType(imageType string) string {
	switch strings.ToLower(strings.TrimSpace(imageType)) {
	case "first_frame":
		return "first_frame"
	case "end_frame", "last_frame":
		return "end_frame"
	default:
		return ""
	}
}

func validateFrameTypesAndAudios(body map[string]any) error {
	hasFrameType := false
	images, _ := body["images"].([]any)
	for _, item := range images {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		imageType, _ := itemMap["type"].(string)
		normalized := normalizeFrameType(imageType)
		if imageType != "" && normalized == "" {
			return fmt.Errorf("invalid images[].type: %s", imageType)
		}
		if normalized != "" {
			hasFrameType = true
		}
	}
	if !hasFrameType {
		return nil
	}
	audios, ok := body["audios"].([]any)
	if ok && len(audios) > 0 {
		return fmt.Errorf("audios cannot be used together with first_frame/end_frame image types")
	}
	return nil
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}

func parseDuration(body map[string]any) int {
	if duration := intFromAny(body["duration"]); duration != 0 {
		return duration
	}
	if seconds := asString(body["seconds"]); seconds != "" {
		n, _ := strconv.Atoi(seconds)
		return n
	}
	return 0
}

func intFromAny(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case string:
		i, _ := strconv.Atoi(n)
		return i
	default:
		return 0
	}
}
