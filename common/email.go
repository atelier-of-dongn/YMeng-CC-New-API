package common

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"html"
	"mime/multipart"
	"net/smtp"
	"net/textproto"
	"net/url"
	"slices"
	"strings"
	"time"
)

func generateMessageID() (string, error) {
	split := strings.Split(SMTPFrom, "@")
	if len(split) < 2 {
		return "", fmt.Errorf("invalid SMTP account")
	}
	domain := strings.Split(SMTPFrom, "@")[1]
	return fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), GetRandomString(12), domain), nil
}

func shouldUseSMTPLoginAuth() bool {
	if SMTPForceAuthLogin {
		return true
	}
	return isOutlookServer(SMTPAccount) || slices.Contains(EmailLoginAuthServerList, SMTPServer)
}

func getSMTPAuth() smtp.Auth {
	return AutoSMTPAuth(SMTPAccount, SMTPToken)
}

func shouldAuthenticateSMTP() bool {
	return SMTPAccount != "" && SMTPToken != ""
}

func smtpTLSConfig() *tls.Config {
	return &tls.Config{
		ServerName:         SMTPServer,
		InsecureSkipVerify: SMTPInsecureSkipVerify, // #nosec G402 -- admin-controlled SMTP compatibility option.
	}
}

func newSMTPClient(addr string) (*smtp.Client, error) {
	if SMTPSSLEnabled || (SMTPPort == 465 && !SMTPStartTLSEnabled) {
		conn, err := tls.Dial("tcp", addr, smtpTLSConfig())
		if err != nil {
			return nil, err
		}
		client, err := smtp.NewClient(conn, SMTPServer)
		if err != nil {
			_ = conn.Close()
			return nil, err
		}
		return client, nil
	}

	client, err := smtp.Dial(addr)
	if err != nil {
		return nil, err
	}

	if SMTPStartTLSEnabled {
		startTLSSupported, _ := client.Extension("STARTTLS")
		if !startTLSSupported {
			_ = client.Close()
			return nil, fmt.Errorf("SMTP server does not support STARTTLS")
		}
		if err := client.StartTLS(smtpTLSConfig()); err != nil {
			_ = client.Close()
			return nil, err
		}
	}

	return client, nil
}

func SendEmail(subject string, receiver string, content string) error {
	return sendEmail(subject, receiver, content, nil)
}

// SendEmailWithAttachment sends an HTML email with one binary attachment.
func SendEmailWithAttachment(subject string, receiver string, content string, attachmentName string, attachment []byte, attachmentContentType string) error {
	if strings.TrimSpace(attachmentName) == "" || len(attachment) == 0 {
		return fmt.Errorf("email attachment is empty")
	}
	if strings.TrimSpace(attachmentContentType) == "" {
		attachmentContentType = "application/octet-stream"
	}
	return sendEmail(subject, receiver, content, &emailAttachment{
		name:        attachmentName,
		content:     attachment,
		contentType: attachmentContentType,
	})
}

type emailAttachment struct {
	name        string
	content     []byte
	contentType string
}

func sendEmail(subject string, receiver string, content string, attachment *emailAttachment) error {
	if SMTPFrom == "" { // for compatibility
		SMTPFrom = SMTPAccount
	}
	id, err := generateMessageID()
	if err != nil {
		return err
	}
	if SMTPServer == "" && SMTPAccount == "" {
		return fmt.Errorf("SMTP 服务器未配置")
	}

	mail, err := buildEmailMessage(subject, receiver, content, id, attachment)
	if err != nil {
		return err
	}
	return deliverEmail(receiver, mail)
}

func buildEmailHTML(content string) string {
	trimmed := strings.TrimSpace(content)
	lowerContent := strings.ToLower(trimmed)
	if strings.HasPrefix(lowerContent, "<!doctype html") || strings.HasPrefix(lowerContent, "<html") {
		return content
	}

	systemName := html.EscapeString(SystemName)
	return fmt.Sprintf(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>%s</title>
</head>
<body style="margin:0;padding:0;background:#f3f6fa;color:#263449;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">%s</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%%" style="background:#f3f6fa;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%%" style="max-width:600px;background:#ffffff;border:1px solid #e3e9f1;border-radius:10px;overflow:hidden;">
<tr><td style="padding:22px 30px;background:#15253d;color:#ffffff;font-size:18px;font-weight:700;">%s</td></tr>
<tr><td style="padding:30px;font-size:15px;line-height:1.8;color:#344256;">%s</td></tr>
<tr><td style="padding:18px 30px 22px;border-top:1px solid #edf1f5;color:#8995a6;font-size:12px;line-height:1.6;">此邮件由 %s 自动发送，请勿直接回复。</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`, systemName, systemName, systemName, content, systemName)
}

func buildEmailMessage(subject string, receiver string, content string, id string, attachment *emailAttachment) ([]byte, error) {
	content = buildEmailHTML(content)
	encodedSubject := fmt.Sprintf("=?UTF-8?B?%s?=", base64.StdEncoding.EncodeToString([]byte(subject)))
	headers := fmt.Sprintf("To: %s\r\n"+
		"From: %s <%s>\r\n"+
		"Subject: %s\r\n"+
		"Date: %s\r\n"+
		"Message-ID: %s\r\n",
		receiver, SystemName, SMTPFrom, encodedSubject, time.Now().Format(time.RFC1123Z), id)
	if attachment == nil {
		return []byte(headers + "Content-Type: text/html; charset=UTF-8\r\n\r\n" + content + "\r\n"), nil
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	boundary := writer.Boundary()
	if _, err := body.WriteString(headers); err != nil {
		return nil, err
	}
	if _, err := fmt.Fprintf(&body, "MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=%q\r\n\r\n", boundary); err != nil {
		return nil, err
	}
	if _, err := fmt.Fprintf(&body, "--%s\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n%s\r\n", boundary, content); err != nil {
		return nil, err
	}

	partHeader := make(textproto.MIMEHeader)
	partHeader.Set("Content-Type", attachment.contentType)
	partHeader.Set("Content-Transfer-Encoding", "base64")
	partHeader.Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(attachment.name)))
	part, err := writer.CreatePart(partHeader)
	if err != nil {
		return nil, err
	}
	encoded := make([]byte, base64.StdEncoding.EncodedLen(len(attachment.content)))
	base64.StdEncoding.Encode(encoded, attachment.content)
	for len(encoded) > 0 {
		lineLength := min(76, len(encoded))
		if _, err := part.Write(encoded[:lineLength]); err != nil {
			return nil, err
		}
		if _, err := part.Write([]byte("\r\n")); err != nil {
			return nil, err
		}
		encoded = encoded[lineLength:]
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return append(body.Bytes(), '\r', '\n'), nil
}

func deliverEmail(receiver string, mail []byte) error {
	auth := getSMTPAuth()
	addr := fmt.Sprintf("%s:%d", SMTPServer, SMTPPort)
	to := strings.Split(receiver, ";")
	client, err := newSMTPClient(addr)
	if err != nil {
		return err
	}
	defer client.Close()
	if shouldAuthenticateSMTP() {
		if err = client.Auth(auth); err != nil {
			return err
		}
	}
	if err = client.Mail(SMTPFrom); err != nil {
		return err
	}
	for _, recipient := range to {
		if err = client.Rcpt(recipient); err != nil {
			return err
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err = w.Write(mail); err != nil {
		return err
	}
	if err = w.Close(); err != nil {
		return err
	}
	if err = client.Quit(); err != nil {
		SysError(fmt.Sprintf("failed to send email to %s: %v", receiver, err))
	}
	return err
}
