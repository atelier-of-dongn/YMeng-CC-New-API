package service

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type invoiceSMTPServer struct {
	listener net.Listener
	messages chan string
}

func newInvoiceSMTPServer(t *testing.T, messageCount int) *invoiceSMTPServer {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	server := &invoiceSMTPServer{
		listener: listener,
		messages: make(chan string, messageCount),
	}
	go server.serve(messageCount)
	return server
}

func (server *invoiceSMTPServer) serve(messageCount int) {
	defer server.listener.Close()
	for range messageCount {
		connection, err := server.listener.Accept()
		if err != nil {
			return
		}
		server.handle(connection)
	}
}

func (server *invoiceSMTPServer) handle(connection net.Conn) {
	defer connection.Close()
	rw := bufio.NewReadWriter(bufio.NewReader(connection), bufio.NewWriter(connection))
	writeLine := func(line string) error {
		if _, err := rw.WriteString(line + "\r\n"); err != nil {
			return err
		}
		return rw.Flush()
	}
	if err := writeLine("220 invoice.test ESMTP"); err != nil {
		return
	}
	for {
		line, err := rw.ReadString('\n')
		if err != nil {
			return
		}
		switch strings.ToUpper(strings.TrimSpace(line)) {
		case "EHLO INVOICE.TEST", "HELO INVOICE.TEST":
			if err := writeLine("250 invoice.test"); err != nil {
				return
			}
		case "MAIL FROM:<sender@example.com>":
			if err := writeLine("250 sender accepted"); err != nil {
				return
			}
		case "RCPT TO:<notification@example.com>", "RCPT TO:<login@example.com>":
			if err := writeLine("250 recipient accepted"); err != nil {
				return
			}
		case "DATA":
			if err := writeLine("354 start mail input"); err != nil {
				return
			}
			var message strings.Builder
			for {
				dataLine, readErr := rw.ReadString('\n')
				if readErr != nil {
					return
				}
				if strings.TrimRight(dataLine, "\r\n") == "." {
					break
				}
				message.WriteString(dataLine)
			}
			server.messages <- message.String()
			if err := writeLine("250 queued"); err != nil {
				return
			}
		case "QUIT":
			_ = writeLine("221 bye")
			return
		default:
			if err := writeLine("250 ok"); err != nil {
				return
			}
		}
	}
}

func invoiceSMTPAddress(server *invoiceSMTPServer) (string, int) {
	address := server.listener.Addr().String()
	host, portText, _ := net.SplitHostPort(address)
	port, _ := strconv.Atoi(portText)
	return host, port
}

func setupInvoiceEmailTest(t *testing.T, db *gorm.DB, server *invoiceSMTPServer) {
	t.Helper()
	previousDB := model.DB
	model.DB = db
	previousServer, previousPort := common.SMTPServer, common.SMTPPort
	previousSSL, previousStartTLS := common.SMTPSSLEnabled, common.SMTPStartTLSEnabled
	previousAccount, previousFrom, previousToken := common.SMTPAccount, common.SMTPFrom, common.SMTPToken
	t.Cleanup(func() {
		model.DB = previousDB
		common.SMTPServer, common.SMTPPort = previousServer, previousPort
		common.SMTPSSLEnabled, common.SMTPStartTLSEnabled = previousSSL, previousStartTLS
		common.SMTPAccount, common.SMTPFrom, common.SMTPToken = previousAccount, previousFrom, previousToken
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	host, port := invoiceSMTPAddress(server)
	common.SMTPServer = host
	common.SMTPPort = port
	common.SMTPSSLEnabled = false
	common.SMTPStartTLSEnabled = false
	common.SMTPAccount = ""
	common.SMTPFrom = "sender@example.com"
	common.SMTPToken = ""
}

func TestSendIssuedInvoiceEmailUsesNotificationEmailAndAttachesPDF(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.InvoiceApplication{}))
	server := newInvoiceSMTPServer(t, 2)
	setupInvoiceEmailTest(t, db, server)

	dir := t.TempDir()
	t.Setenv("INVOICE_STORAGE_DIR", dir)
	pdf := []byte("%PDF-1.7\n%%EOF")
	require.NoError(t, os.WriteFile(filepath.Join(dir, "invoice.pdf"), pdf, 0600))

	user := &model.User{Username: "invoice-email-user", Email: "login@example.com", Status: common.UserStatusEnabled}
	user.SetSetting(dto.UserSetting{NotificationEmail: "notification@example.com"})
	require.NoError(t, db.Create(user).Error)
	application := &model.InvoiceApplication{
		UserId:    user.Id,
		Title:     "<公司>",
		TaxId:     "TAX&1",
		NetAmount: 501 * model.InvoiceAmountScale,
		Status:    model.InvoiceStatusIssued,
		IssuedAt:  time.Unix(1700000000, 0).Unix(),
		FileKey:   "invoice.pdf",
		FileName:  "发票.pdf",
		FileSize:  int64(len(pdf)),
	}
	require.NoError(t, db.Create(application).Error)

	require.NoError(t, SendIssuedInvoiceEmail(application.Id))
	message := <-server.messages
	assert.Contains(t, message, "To: notification@example.com")
	assert.Contains(t, message, "Invoice issued")
	assert.Contains(t, message, "This email was sent automatically by")
	assert.NotContains(t, message, "此邮件由")
	assert.Contains(t, message, "&lt;公司&gt;")
	assert.Contains(t, message, "TAX&amp;1")
	assert.Contains(t, message, "Content-Type: application/pdf")
	assert.Contains(t, message, "JVBERi0xLjcKJSVFT0Y=")

	user.SetSetting(dto.UserSetting{})
	require.NoError(t, db.Save(user).Error)
	require.NoError(t, SendIssuedInvoiceEmail(application.Id))
	assert.Contains(t, <-server.messages, "To: login@example.com")
}

func TestSendIssuedInvoiceEmailRejectsMissingRecipient(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.InvoiceApplication{}))
	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	user := &model.User{Username: "invoice-no-email", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(user).Error)
	application := &model.InvoiceApplication{UserId: user.Id, Status: model.InvoiceStatusIssued, FileKey: "missing.pdf"}
	require.NoError(t, db.Create(application).Error)

	require.ErrorIs(t, SendIssuedInvoiceEmail(application.Id), ErrInvoiceEmailRecipientMissing)
}
