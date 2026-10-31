package controller

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type supportTicketResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Status        string `json:"status"`
		RequestId     string `json:"request_id"`
		HasAttachment bool   `json:"has_attachment"`
		Log           *struct {
			RequestId string `json:"request_id"`
			Content   string `json:"content"`
			Type      int    `json:"type"`
			ModelName string `json:"model_name"`
			CreatedAt int64  `json:"created_at"`
		} `json:"request_log"`
		Messages []struct {
			AuthorRole     string `json:"role"`
			Content        string `json:"content"`
			AttachmentName string `json:"attachment_name"`
			HasAttachment  bool   `json:"has_attachment"`
		} `json:"messages"`
	} `json:"data"`
}

func setupSupportTicketControllerTestDB(t *testing.T) (*gorm.DB, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	previousDB, previousLogDB := model.DB, model.LOG_DB
	name := strings.ReplaceAll(t.Name(), "/", "_")
	mainDB, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s_main?mode=memory&cache=shared", name)), &gorm.Config{})
	require.NoError(t, err)
	logDB, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s_log?mode=memory&cache=shared", name)), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = mainDB, logDB
	require.NoError(t, mainDB.AutoMigrate(&model.User{}, &model.SupportTicket{}, &model.SupportTicketMessage{}))
	require.NoError(t, logDB.AutoMigrate(&model.Log{}))
	require.NoError(t, mainDB.Create(&model.User{Id: 1, Username: "owner", Password: "password", AffCode: "owner-aff"}).Error)
	require.NoError(t, mainDB.Create(&model.User{Id: 2, Username: "other", Password: "password", AffCode: "other-aff"}).Error)
	require.NoError(t, mainDB.Create(&model.User{Id: 9, Username: "admin", Password: "password", AffCode: "admin-aff"}).Error)
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		for _, db := range []*gorm.DB{mainDB, logDB} {
			sqlDB, dbErr := db.DB()
			if dbErr == nil {
				_ = sqlDB.Close()
			}
		}
	})
	return mainDB, logDB
}

func createSupportTicketRequest(t *testing.T, userID int, content, requestID, filename string, attachment []byte, omitFile bool) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("content", content))
	require.NoError(t, writer.WriteField("request_id", requestID))
	if !omitFile {
		part, err := writer.CreateFormFile("file", filename)
		require.NoError(t, err)
		_, err = part.Write(attachment)
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/support-ticket/", &body)
	ctx.Request.Header.Set("Content-Type", writer.FormDataContentType())
	ctx.Set("id", userID)
	CreateSupportTicket(ctx)
	return recorder
}

func decodeSupportTicketResponse(t *testing.T, recorder *httptest.ResponseRecorder) supportTicketResponse {
	t.Helper()
	var response supportTicketResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response), recorder.Body.String())
	return response
}

func createSupportTicketSuccessfully(t *testing.T, userID int, content, requestID, filename string, attachment []byte, omitFile bool) int {
	t.Helper()
	recorder := createSupportTicketRequest(t, userID, content, requestID, filename, attachment, omitFile)
	response := decodeSupportTicketResponse(t, recorder)
	require.True(t, response.Success, recorder.Body.String())
	var ticket model.SupportTicket
	require.NoError(t, model.DB.Order("id DESC").First(&ticket).Error)
	return ticket.Id
}

func TestSupportTicketCreationInputsAndLogOwnership(t *testing.T) {
	_, logDB := setupSupportTicketControllerTestDB(t)
	logEntry := &model.Log{UserId: 1, RequestId: "req-owned", Content: "safe log summary", Type: model.LogTypeConsume, ModelName: "model-a", CreatedAt: 123, Other: "private diagnostics"}
	require.NoError(t, logDB.Create(logEntry).Error)
	require.NoError(t, logDB.Create(&model.Log{UserId: 2, RequestId: "req-other", Content: "other user's log", CreatedAt: 124}).Error)

	t.Run("content only", func(t *testing.T) {
		createSupportTicketSuccessfully(t, 1, "  feedback  ", "", "", nil, true)
	})
	t.Run("request ID only snapshots safe metadata", func(t *testing.T) {
		ticketID := createSupportTicketSuccessfully(t, 1, "", "req-owned", "", nil, true)
		require.NoError(t, logDB.Where("request_id = ?", "req-owned").Delete(&model.Log{}).Error)
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(ticketID)}}
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/support-ticket/self/"+strconv.Itoa(ticketID), nil)
		ctx.Set("id", 1)
		GetUserSupportTicket(ctx)
		response := decodeSupportTicketResponse(t, recorder)
		require.True(t, response.Success)
		require.NotNil(t, response.Data.Log)
		assert.Equal(t, "req-owned", response.Data.RequestId)
		assert.Equal(t, "safe log summary", response.Data.Log.Content)
		assert.Equal(t, model.LogTypeConsume, response.Data.Log.Type)
		assert.Equal(t, "model-a", response.Data.Log.ModelName)
		assert.Equal(t, int64(123), response.Data.Log.CreatedAt)
		assert.NotContains(t, recorder.Body.String(), "private diagnostics")
		assert.NotContains(t, recorder.Body.String(), "attachment_data")
	})
	t.Run("attachment only", func(t *testing.T) {
		createSupportTicketSuccessfully(t, 1, "", "", "../notes.MD", []byte("# Notes\n"), false)
	})
	t.Run("rejects invalid inputs", func(t *testing.T) {
		tests := []struct {
			name       string
			content    string
			requestID  string
			filename   string
			attachment []byte
			omitFile   bool
		}{
			{name: "empty", omitFile: true},
			{name: "content too long", content: strings.Repeat("界", model.SupportTicketMaxContentRunes+1), omitFile: true},
			{name: "missing request", requestID: "req-missing", omitFile: true},
			{name: "other user's request", requestID: "req-other", omitFile: true},
			{name: "extension", filename: "notes.txt", attachment: []byte("text")},
			{name: "empty file", filename: "notes.md"},
			{name: "whitespace only file", filename: "notes.md", attachment: []byte(" \n")},
			{name: "invalid UTF-8", filename: "notes.md", attachment: []byte{0xff}},
			{name: "NUL", filename: "notes.md", attachment: []byte{'a', 0, 'b'}},
			{name: "too large", filename: "notes.md", attachment: bytes.Repeat([]byte{'a'}, model.SupportTicketMaxAttachmentSize+1)},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				recorder := createSupportTicketRequest(t, 1, test.content, test.requestID, test.filename, test.attachment, test.omitFile)
				assert.False(t, decodeSupportTicketResponse(t, recorder).Success, recorder.Body.String())
			})
		}
	})
}

func TestSupportTicketConversationIsolationAndDownload(t *testing.T) {
	mainDB, _ := setupSupportTicketControllerTestDB(t)
	ticketID := createSupportTicketSuccessfully(t, 1, "initial", "", "../safe.markdown", []byte("# Safe\n"), false)

	readTicket := func(userID int, admin bool) (*httptest.ResponseRecorder, supportTicketResponse) {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(ticketID)}}
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/support-ticket/self/"+strconv.Itoa(ticketID), nil)
		ctx.Set("id", userID)
		if admin {
			GetAdminSupportTicket(ctx)
		} else {
			GetUserSupportTicket(ctx)
		}
		return recorder, decodeSupportTicketResponse(t, recorder)
	}
	_, denied := readTicket(2, false)
	assert.False(t, denied.Success)

	reply := func(userID int, admin bool, content string) (*httptest.ResponseRecorder, supportTicketResponse) {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(ticketID)}}
		ctx.Request = httptest.NewRequest(http.MethodPost, "/api/support-ticket/self/"+strconv.Itoa(ticketID)+"/replies", strings.NewReader(fmt.Sprintf(`{"content":%q}`, content)))
		ctx.Set("id", userID)
		if admin {
			ReplyToAdminSupportTicket(ctx)
		} else {
			ReplyToUserSupportTicket(ctx)
		}
		return recorder, decodeSupportTicketResponse(t, recorder)
	}
	_, adminReply := reply(9, true, "admin answer")
	require.True(t, adminReply.Success)
	assert.Equal(t, model.SupportTicketStatusReplied, adminReply.Data.Status)
	_, userReply := reply(1, false, "user follow-up")
	require.True(t, userReply.Success)
	assert.Equal(t, model.SupportTicketStatusPending, userReply.Data.Status)
	_, otherReply := reply(2, false, "should not be added")
	assert.False(t, otherReply.Success)
	_, emptyReply := reply(1, false, "  ")
	assert.False(t, emptyReply.Success)
	_, longReply := reply(1, false, strings.Repeat("a", model.SupportTicketMaxContentRunes+1))
	assert.False(t, longReply.Success)

	require.NoError(t, mainDB.Model(&model.SupportTicketMessage{}).Where("id > 1").Update("created_at", gorm.Expr("created_at + id")).Error)
	recorder, detail := readTicket(1, false)
	require.True(t, detail.Success)
	assert.True(t, detail.Data.HasAttachment)
	require.Len(t, detail.Data.Messages, 3)
	assert.Equal(t, []string{"initial", "admin answer", "user follow-up"}, []string{detail.Data.Messages[0].Content, detail.Data.Messages[1].Content, detail.Data.Messages[2].Content})
	assert.Equal(t, []string{"user", "admin", "user"}, []string{detail.Data.Messages[0].AuthorRole, detail.Data.Messages[1].AuthorRole, detail.Data.Messages[2].AuthorRole})
	assert.Equal(t, "safe.markdown", detail.Data.Messages[0].AttachmentName)
	assert.NotContains(t, recorder.Body.String(), "# Safe")

	download := func(userID int, admin bool) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(ticketID)}}
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/support-ticket/self/"+strconv.Itoa(ticketID)+"/attachment", nil)
		ctx.Set("id", userID)
		if admin {
			DownloadAdminSupportTicketAttachment(ctx)
		} else {
			DownloadUserSupportTicketAttachment(ctx)
		}
		return recorder
	}
	file := download(1, false)
	assert.Equal(t, http.StatusOK, file.Code)
	assert.Equal(t, "# Safe\n", file.Body.String())
	assert.Equal(t, "text/plain; charset=utf-8", file.Header().Get("Content-Type"))
	assert.Equal(t, "private, no-store", file.Header().Get("Cache-Control"))
	assert.Equal(t, "nosniff", file.Header().Get("X-Content-Type-Options"))
	assert.Contains(t, file.Header().Get("Content-Disposition"), "attachment")
	assert.False(t, decodeSupportTicketResponse(t, download(2, false)).Success)
	assert.Equal(t, http.StatusOK, download(9, true).Code)

	var count int64
	require.NoError(t, mainDB.Model(&model.SupportTicketMessage{}).Count(&count).Error)
	assert.Equal(t, int64(3), count)
}

func TestSupportTicketListsAndAdminFilters(t *testing.T) {
	mainDB, logDB := setupSupportTicketControllerTestDB(t)
	now := time.Now().Unix()
	require.NoError(t, mainDB.Create(&model.SupportTicket{UserId: 1, Username: "owner", Status: model.SupportTicketStatusPending, RequestId: "alpha", CreatedAt: now, UpdatedAt: now, LastMessageAt: now}).Error)
	require.NoError(t, mainDB.Create(&model.SupportTicket{UserId: 2, Username: "other", Status: model.SupportTicketStatusReplied, RequestId: "beta", CreatedAt: now, UpdatedAt: now, LastMessageAt: now + 1}).Error)
	require.NoError(t, logDB.AutoMigrate(&model.Log{}))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/support-ticket/self?p=1&page_size=20", nil)
	ctx.Set("id", 1)
	GetUserSupportTickets(ctx)
	var userPage struct {
		Data struct {
			Total int `json:"total"`
			Items []struct {
				UserId   int    `json:"user_id"`
				Username string `json:"username"`
			} `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &userPage))
	assert.Equal(t, 1, userPage.Data.Total)
	require.Len(t, userPage.Data.Items, 1)
	assert.Equal(t, 1, userPage.Data.Items[0].UserId)
	assert.NotContains(t, recorder.Body.String(), "attachment_data")

	for _, query := range []string{"p=0", "page_size=101", "ps=1000000", "size=-1", "p=bad"} {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/support-ticket/admin/?"+query, nil)
		GetAllSupportTickets(ctx)
		assert.Contains(t, recorder.Body.String(), `"success":false`, query)
	}

	recorder = httptest.NewRecorder()
	ctx, _ = gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/support-ticket/admin/?status=replied&username=OTH&request_id=beta", nil)
	GetAllSupportTickets(ctx)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &userPage))
	assert.Equal(t, 1, userPage.Data.Total)
	require.Len(t, userPage.Data.Items, 1)
	assert.Equal(t, "other", userPage.Data.Items[0].Username)
}
