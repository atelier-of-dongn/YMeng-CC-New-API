package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateOptionRejectsInvalidBaoCodeLinkBeforeDatabase(t *testing.T) {
	previousDB := model.DB
	model.DB = nil
	t.Cleanup(func() { model.DB = previousDB })

	for _, value := range []string{
		"", " \t\n ", "/relative/path", "//baocode.dev/path", "baocode.dev",
		"javascript:alert(1)", "ftp://baocode.dev/", "https:///missing-host",
		"https:baocode.dev", "https://bad host/", "https://baocode.dev/%zz",
	} {
		t.Run(value, func(t *testing.T) {
			body, err := common.Marshal(OptionUpdateRequest{Key: "general_setting.baocode_link", Value: value})
			require.NoError(t, err)
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", bytes.NewReader(body))

			UpdateOption(context)

			assert.Equal(t, http.StatusOK, response.Code)
			assert.JSONEq(t, `{"success":false,"message":"Enter an absolute HTTP(S) URL","message_key":"Enter an absolute HTTP(S) URL"}`, response.Body.String())
		})
	}
}

func TestGetStatusReturnsBaoCodeLink(t *testing.T) {
	settings := operation_setting.GetGeneralSetting()
	previous := settings.BaoCodeLink
	t.Cleanup(func() { settings.BaoCodeLink = previous })
	require.Equal(t, "https://baocode.dev/?ymengcc", settings.BaoCodeLink)

	for _, value := range []string{settings.BaoCodeLink, "http://example.com/start?ref=custom&next=%2Fhome#install"} {
		t.Run(value, func(t *testing.T) {
			settings.BaoCodeLink = value
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

			GetStatus(context)

			var payload struct {
				Success bool `json:"success"`
				Data    struct {
					BaoCodeLink string `json:"baocode_link"`
				} `json:"data"`
			}
			require.Equal(t, http.StatusOK, response.Code)
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			assert.True(t, payload.Success)
			assert.Equal(t, value, payload.Data.BaoCodeLink)
		})
	}
}
