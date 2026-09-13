package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskLogSnapshotResponse(t *testing.T) {
	snapshot := &common.RequestParametersSnapshot{Parameters: map[string]any{"prompt": "task prompt", "watermark": false}}
	task := &model.Task{TaskID: "task-1", PrivateData: model.TaskPrivateData{Key: "private-key", RequestSnapshot: snapshot}}
	items := tasksToDto([]*model.Task{task}, false)
	require.Len(t, items, 1)
	data, err := common.Marshal(items[0])
	require.NoError(t, err)
	var response map[string]any
	require.NoError(t, common.Unmarshal(data, &response))
	assert.Contains(t, response, "request_parameters")
	assert.NotContains(t, response, "private_data")
	assert.NotContains(t, string(data), "private-key")
	task.PrivateData.RequestSnapshot = nil
	data, err = common.Marshal(tasksToDto([]*model.Task{task}, false)[0])
	require.NoError(t, err)
	assert.NotContains(t, string(data), "request_parameters")
}
