package controller

import (
	"bytes"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

type supportTicketReplyRequest struct {
	Content string `json:"content"`
}

func supportTicketID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid support ticket")
		return 0, false
	}
	return id, true
}

func supportTicketPageQuery(c *gin.Context) (*common.PageInfo, bool) {
	for _, key := range []string{"p", "page_size", "ps", "size"} {
		raw := strings.TrimSpace(c.Query(key))
		if raw == "" {
			continue
		}
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || (key != "p" && value > 100) {
			common.ApiErrorMsg(c, "invalid support ticket pagination")
			return nil, false
		}
	}
	return common.GetPageQuery(c), true
}

func CreateSupportTicket(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, model.SupportTicketMaxAttachmentSize+(1<<20))
	content := c.PostForm("content")
	requestID := c.PostForm("request_id")
	var attachmentName string
	var attachmentData []byte
	header, err := c.FormFile("file")
	if err == nil {
		attachmentName = strings.TrimSpace(strings.ReplaceAll(header.Filename, `\`, "/"))
		attachmentName = path.Base(attachmentName)
		extension := strings.ToLower(path.Ext(attachmentName))
		if attachmentName == "." || len([]rune(attachmentName)) > 255 || !utf8.ValidString(attachmentName) || (extension != ".md" && extension != ".markdown") {
			common.ApiError(c, model.ErrSupportTicketAttachment)
			return
		}
		file, openErr := header.Open()
		if openErr != nil {
			common.ApiErrorMsg(c, "failed to read Markdown attachment")
			return
		}
		defer file.Close()
		buffer := bytes.NewBuffer(nil)
		buffer.Grow(int(min(int64(model.SupportTicketMaxAttachmentSize), max(header.Size, 0)) + 1))
		if _, readErr := buffer.ReadFrom(http.MaxBytesReader(c.Writer, file, model.SupportTicketMaxAttachmentSize+1)); readErr != nil {
			common.ApiError(c, model.ErrSupportTicketAttachment)
			return
		}
		attachmentData = buffer.Bytes()
	} else if err != http.ErrMissingFile {
		common.ApiError(c, model.ErrSupportTicketAttachment)
		return
	}
	ticket, err := model.CreateSupportTicket(c.GetInt("id"), content, requestID, attachmentName, attachmentData)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, ticket)
}

func GetUserSupportTickets(c *gin.Context) {
	pageInfo, ok := supportTicketPageQuery(c)
	if !ok {
		return
	}
	tickets, total, err := model.GetUserSupportTickets(c.GetInt("id"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(tickets)
	common.ApiSuccess(c, pageInfo)
}

func GetAllSupportTickets(c *gin.Context) {
	status := strings.TrimSpace(c.Query("status"))
	requestID := strings.TrimSpace(c.Query("request_id"))
	username := strings.TrimSpace(c.Query("username"))
	if (status != "" && status != model.SupportTicketStatusPending && status != model.SupportTicketStatusReplied) || len(requestID) > 64 || len([]rune(username)) > 255 {
		common.ApiErrorMsg(c, "invalid support ticket filters")
		return
	}
	pageInfo, ok := supportTicketPageQuery(c)
	if !ok {
		return
	}
	tickets, total, err := model.GetAllSupportTickets(model.SupportTicketFilters{
		Status:    status,
		Username:  username,
		RequestId: requestID,
	}, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(tickets)
	common.ApiSuccess(c, pageInfo)
}

func getSupportTicket(c *gin.Context, admin bool) {
	id, ok := supportTicketID(c)
	if !ok {
		return
	}
	userID := c.GetInt("id")
	if admin {
		userID = 0
	}
	ticket, err := model.GetSupportTicket(id, userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, ticket)
}

func GetUserSupportTicket(c *gin.Context) {
	getSupportTicket(c, false)
}

func GetAdminSupportTicket(c *gin.Context) {
	getSupportTicket(c, true)
}

func replyToSupportTicket(c *gin.Context, admin bool) {
	id, ok := supportTicketID(c)
	if !ok {
		return
	}
	var request supportTicketReplyRequest
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20), &request); err != nil {
		common.ApiErrorMsg(c, "invalid support ticket reply")
		return
	}
	userID := c.GetInt("id")
	if admin {
		userID = 0
	}
	ticket, err := model.ReplyToSupportTicket(id, userID, c.GetInt("id"), admin, request.Content)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, ticket)
}

func ReplyToUserSupportTicket(c *gin.Context) {
	replyToSupportTicket(c, false)
}

func ReplyToAdminSupportTicket(c *gin.Context) {
	replyToSupportTicket(c, true)
}

func downloadSupportTicketAttachment(c *gin.Context, admin bool) {
	id, ok := supportTicketID(c)
	if !ok {
		return
	}
	userID := c.GetInt("id")
	if admin {
		userID = 0
	}
	message, err := model.GetSupportTicketAttachment(id, userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": message.AttachmentName}))
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, "text/plain; charset=utf-8", message.AttachmentData)
}

func DownloadUserSupportTicketAttachment(c *gin.Context) {
	downloadSupportTicketAttachment(c, false)
}

func DownloadAdminSupportTicketAttachment(c *gin.Context) {
	downloadSupportTicketAttachment(c, true)
}
