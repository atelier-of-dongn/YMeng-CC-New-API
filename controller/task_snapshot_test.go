package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskLogSnapshotResponse(t *testing.T) {
	task := &model.Task{TaskID: "task-1", FailReason: "https://example.com/video.mp4", PrivateData: model.TaskPrivateData{Key: "private-key"}}
	items := tasksToDto([]*model.Task{task}, false, common.RoleCommonUser)
	require.Len(t, items, 1)
	data, err := common.Marshal(items[0])
	require.NoError(t, err)
	var response map[string]any
	require.NoError(t, common.Unmarshal(data, &response))
	assert.NotContains(t, response, "private_data")
	assert.NotContains(t, string(data), "private-key")
}
