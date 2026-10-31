package model

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

const (
	SupportTicketStatusPending = "pending"
	SupportTicketStatusReplied = "replied"

	SupportTicketAuthorUser  = "user"
	SupportTicketAuthorAdmin = "admin"

	SupportTicketMaxContentRunes   = 20_000
	SupportTicketMaxAttachmentSize = 1 << 20
	supportTicketMaxLogRunes       = 2_000
)

var (
	ErrSupportTicketNotFound         = errors.New("support ticket not found")
	ErrSupportTicketEmpty            = errors.New("feedback, request ID, or Markdown attachment is required")
	ErrSupportTicketContent          = errors.New("support ticket content must be 20000 characters or fewer")
	ErrSupportTicketReplyContent     = errors.New("reply content is required and must be 20000 characters or fewer")
	ErrSupportTicketRequest          = errors.New("request ID is invalid or does not belong to the current user")
	ErrSupportTicketAttachment       = errors.New("Markdown attachment must be a non-empty UTF-8 file of at most 1 MiB without NUL bytes")
	ErrSupportTicketAttachmentAbsent = errors.New("support ticket attachment not found")
)

// SupportTicketBlob uses a column large enough for a 1 MiB attachment on each
// supported main database. A plain blob on MySQL would be limited to 64 KiB.
type SupportTicketBlob []byte

func (SupportTicketBlob) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
	switch db.Dialector.Name() {
	case string(common.DatabaseTypeMySQL):
		return "longblob"
	case string(common.DatabaseTypePostgreSQL):
		return "bytea"
	default:
		return "blob"
	}
}

type SupportTicketLogMetadata struct {
	RequestId string `json:"request_id"`
	Content   string `json:"content"`
	Type      int    `json:"type"`
	ModelName string `json:"model_name"`
	CreatedAt int64  `json:"created_at"`
}

type SupportTicket struct {
	Id            int    `json:"id"`
	UserId        int    `json:"user_id" gorm:"not null;index:idx_support_tickets_user_last_message,priority:1"`
	Username      string `json:"username" gorm:"type:varchar(255);not null"`
	Status        string `json:"status" gorm:"type:varchar(16);not null;index:idx_support_tickets_status_last_message,priority:1"`
	RequestId     string `json:"request_id,omitempty" gorm:"type:varchar(64);not null;index"`
	CreatedAt     int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt     int64  `json:"updated_at" gorm:"type:bigint;not null"`
	LastMessageAt int64  `json:"last_message_at" gorm:"type:bigint;not null;index:idx_support_tickets_user_last_message,priority:2;index:idx_support_tickets_status_last_message,priority:2"`

	RequestLogContent   LongText `json:"-" gorm:"not null"`
	RequestLogType      int      `json:"-" gorm:"not null"`
	RequestLogModel     string   `json:"-" gorm:"type:varchar(255);not null"`
	RequestLogCreatedAt int64    `json:"-" gorm:"type:bigint;not null"`

	Preview       string                    `json:"preview" gorm:"-"`
	HasAttachment bool                      `json:"has_attachment" gorm:"-"`
	Log           *SupportTicketLogMetadata `json:"request_log,omitempty" gorm:"-"`
	Messages      []*SupportTicketMessage   `json:"messages,omitempty" gorm:"-"`
}

type SupportTicketMessage struct {
	Id             int               `json:"id"`
	TicketId       int               `json:"ticket_id" gorm:"not null;index:idx_support_ticket_messages_ticket_created,priority:1"`
	AuthorId       int               `json:"author_id" gorm:"not null"`
	AuthorRole     string            `json:"role" gorm:"type:varchar(16);not null"`
	Username       string            `json:"author_username" gorm:"type:varchar(255);not null"`
	Content        LongText          `json:"content" gorm:"not null"`
	AttachmentName string            `json:"attachment_name,omitempty" gorm:"type:varchar(255);not null"`
	HasAttachment  bool              `json:"has_attachment" gorm:"-"`
	AttachmentData SupportTicketBlob `json:"-"`
	AttachmentSize int               `json:"attachment_size,omitempty" gorm:"not null"`
	CreatedAt      int64             `json:"created_at" gorm:"type:bigint;not null;index:idx_support_ticket_messages_ticket_created,priority:2"`
}

type SupportTicketFilters struct {
	Status    string
	Username  string
	RequestId string
}

func supportTicketLogMetadata(ticket *SupportTicket) *SupportTicketLogMetadata {
	if ticket.RequestId == "" {
		return nil
	}
	return &SupportTicketLogMetadata{
		RequestId: ticket.RequestId,
		Content:   string(ticket.RequestLogContent),
		Type:      ticket.RequestLogType,
		ModelName: ticket.RequestLogModel,
		CreatedAt: ticket.RequestLogCreatedAt,
	}
}

func CreateSupportTicket(userID int, content, requestID, attachmentName string, attachmentData []byte) (*SupportTicket, error) {
	content = strings.TrimSpace(content)
	if len([]rune(content)) > SupportTicketMaxContentRunes {
		return nil, ErrSupportTicketContent
	}
	if len(attachmentData) > 0 {
		if len(attachmentData) > SupportTicketMaxAttachmentSize || !utf8.Valid(attachmentData) || bytes.ContainsRune(attachmentData, '\x00') || len(bytes.TrimSpace(attachmentData)) == 0 || attachmentName == "" {
			return nil, ErrSupportTicketAttachment
		}
	} else {
		attachmentName = ""
	}
	requestID = strings.TrimSpace(requestID)
	if len(requestID) > 64 {
		return nil, ErrSupportTicketRequest
	}
	if content == "" && requestID == "" && len(attachmentData) == 0 {
		return nil, ErrSupportTicketEmpty
	}

	var user User
	if err := DB.Select("id", "username").First(&user, userID).Error; err != nil {
		return nil, err
	}
	ticket := &SupportTicket{
		UserId:    userID,
		Username:  user.Username,
		Status:    SupportTicketStatusPending,
		RequestId: requestID,
	}
	if requestID != "" {
		var logEntry Log
		err := LOG_DB.Select("id", "content", "type", "model_name", "created_at").
			Where("request_id = ? AND user_id = ?", requestID, userID).
			Order("id DESC").Limit(1).Find(&logEntry).Error
		if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
			logEntry.Id = int(logEntry.CreatedAt)
		}
		if logEntry.Id == 0 {
			err = gorm.ErrRecordNotFound
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSupportTicketRequest
		}
		if err != nil {
			return nil, err
		}
		contentRunes := []rune(logEntry.Content)
		if len(contentRunes) > supportTicketMaxLogRunes {
			contentRunes = contentRunes[:supportTicketMaxLogRunes]
		}
		ticket.RequestLogContent = LongText(string(contentRunes))
		ticket.RequestLogType = logEntry.Type
		ticket.RequestLogModel = logEntry.ModelName
		ticket.RequestLogCreatedAt = logEntry.CreatedAt
	}
	now := common.GetTimestamp()
	ticket.CreatedAt = now
	ticket.UpdatedAt = now
	ticket.LastMessageAt = now
	message := &SupportTicketMessage{
		AuthorId:       userID,
		AuthorRole:     SupportTicketAuthorUser,
		Username:       user.Username,
		Content:        LongText(content),
		AttachmentName: attachmentName,
		AttachmentData: bytes.Clone(attachmentData),
		AttachmentSize: len(attachmentData),
		CreatedAt:      now,
	}
	if err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(ticket).Error; err != nil {
			return err
		}
		message.TicketId = ticket.Id
		return tx.Create(message).Error
	}); err != nil {
		return nil, err
	}
	ticket.HasAttachment = attachmentName != ""
	message.HasAttachment = ticket.HasAttachment
	ticket.Log = supportTicketLogMetadata(ticket)
	message.AttachmentData = nil
	ticket.Messages = []*SupportTicketMessage{message}
	return ticket, nil
}

func listSupportTickets(query *gorm.DB, pageInfo *common.PageInfo) ([]*SupportTicket, int64, error) {
	var total int64
	if err := query.Model(&SupportTicket{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tickets []*SupportTicket
	err := query.Select(
		"id", "user_id", "username", "request_id", "status", "created_at", "updated_at", "last_message_at",
		"EXISTS (SELECT 1 FROM support_ticket_messages WHERE support_ticket_messages.ticket_id = support_tickets.id AND support_ticket_messages.attachment_name <> '') AS has_attachment",
	).Order("last_message_at DESC").Order("id DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&tickets).Error
	if err != nil || len(tickets) == 0 {
		return tickets, total, err
	}
	ids := make([]int, len(tickets))
	for i, ticket := range tickets {
		ids[i] = ticket.Id
	}
	var messages []*SupportTicketMessage
	if err := DB.Select("id", "ticket_id", "content", "attachment_name").
		Where("ticket_id IN ?", ids).Order("id ASC").Find(&messages).Error; err != nil {
		return nil, 0, err
	}
	firstMessages := make(map[int]*SupportTicketMessage, len(tickets))
	for _, message := range messages {
		if _, exists := firstMessages[message.TicketId]; !exists {
			firstMessages[message.TicketId] = message
		}
	}
	for _, ticket := range tickets {
		message := firstMessages[ticket.Id]
		if message == nil {
			continue
		}
		ticket.Preview = string(message.Content)
		if ticket.Preview == "" && ticket.RequestId != "" {
			ticket.Preview = ticket.RequestId
		}
		if ticket.Preview == "" {
			ticket.Preview = message.AttachmentName
		}
	}
	return tickets, total, nil
}

func GetUserSupportTickets(userID int, pageInfo *common.PageInfo) ([]*SupportTicket, int64, error) {
	return listSupportTickets(DB.Where("user_id = ?", userID), pageInfo)
}

func GetAllSupportTickets(filters SupportTicketFilters, pageInfo *common.PageInfo) ([]*SupportTicket, int64, error) {
	query := DB.Model(&SupportTicket{})
	if filters.Status != "" {
		query = query.Where("status = ?", filters.Status)
	}
	if filters.Username != "" {
		pattern := strings.ToLower(strings.TrimSpace(filters.Username))
		pattern = strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(pattern)
		query = query.Where("LOWER(username) LIKE ? ESCAPE '!'", "%"+pattern+"%")
	}
	if filters.RequestId != "" {
		query = query.Where("request_id = ?", filters.RequestId)
	}
	return listSupportTickets(query, pageInfo)
}

func GetSupportTicket(id, userID int) (*SupportTicket, error) {
	var ticket SupportTicket
	query := DB.Where("id = ?", id)
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if err := query.First(&ticket).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSupportTicketNotFound
		}
		return nil, err
	}
	var messages []*SupportTicketMessage
	if err := DB.Select("id", "ticket_id", "author_id", "author_role", "username", "content", "attachment_name", "attachment_size", "created_at").
		Where("ticket_id = ?", id).Order("created_at ASC").Order("id ASC").Find(&messages).Error; err != nil {
		return nil, err
	}
	for _, message := range messages {
		message.AttachmentData = nil
		message.HasAttachment = message.AttachmentName != ""
		ticket.HasAttachment = ticket.HasAttachment || message.HasAttachment
	}
	ticket.Messages = messages
	ticket.Log = supportTicketLogMetadata(&ticket)
	return &ticket, nil
}

func ReplyToSupportTicket(id, userID, authorID int, admin bool, content string) (*SupportTicket, error) {
	content = strings.TrimSpace(content)
	if content == "" || len([]rune(content)) > SupportTicketMaxContentRunes {
		return nil, ErrSupportTicketReplyContent
	}
	var author User
	if err := DB.Select("id", "username").First(&author, authorID).Error; err != nil {
		return nil, err
	}
	now := common.GetTimestamp()
	status := SupportTicketStatusPending
	authorRole := SupportTicketAuthorUser
	if admin {
		status = SupportTicketStatusReplied
		authorRole = SupportTicketAuthorAdmin
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var ticket SupportTicket
		query := lockForUpdate(tx).Select("id").Where("id = ?", id)
		if userID > 0 {
			query = query.Where("user_id = ?", userID)
		}
		if err := query.First(&ticket).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSupportTicketNotFound
			}
			return err
		}
		message := &SupportTicketMessage{
			TicketId:   id,
			AuthorId:   authorID,
			AuthorRole: authorRole,
			Username:   author.Username,
			Content:    LongText(content),
			CreatedAt:  now,
		}
		if err := tx.Create(message).Error; err != nil {
			return err
		}
		return tx.Model(&SupportTicket{}).Where("id = ?", id).Updates(map[string]any{
			"status":          status,
			"updated_at":      now,
			"last_message_at": now,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return GetSupportTicket(id, userID)
}

func GetSupportTicketAttachment(id, userID int) (*SupportTicketMessage, error) {
	var ticket SupportTicket
	query := DB.Select("id").Where("id = ?", id)
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if err := query.First(&ticket).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSupportTicketNotFound
		}
		return nil, err
	}
	var message SupportTicketMessage
	if err := DB.Select("attachment_name", "attachment_data").
		Where("ticket_id = ? AND attachment_name <> ''", id).Order("id ASC").First(&message).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSupportTicketAttachmentAbsent
		}
		return nil, err
	}
	if len(message.AttachmentData) == 0 {
		return nil, fmt.Errorf("%w: file is empty", ErrSupportTicketAttachmentAbsent)
	}
	return &message, nil
}
