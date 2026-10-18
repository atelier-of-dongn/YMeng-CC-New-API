package service

import (
	"errors"
	"fmt"
	"html"
	"io"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

var ErrInvoiceEmailRecipientMissing = errors.New("invoice email recipient is missing")

func SendIssuedInvoiceEmail(applicationID int) error {
	var application model.InvoiceApplication
	if err := model.DB.Where("id = ? AND status = ?", applicationID, model.InvoiceStatusIssued).First(&application).Error; err != nil {
		return err
	}

	var user model.User
	if err := model.DB.Select("id", "email", "setting").Where("id = ?", application.UserId).First(&user).Error; err != nil {
		return err
	}
	recipient := strings.TrimSpace(user.GetSetting().NotificationEmail)
	if recipient == "" {
		recipient = strings.TrimSpace(user.Email)
	}
	if recipient == "" {
		return ErrInvoiceEmailRecipientMissing
	}

	file, info, err := OpenInvoiceFile(application.FileKey)
	if err != nil {
		return fmt.Errorf("open invoice PDF: %w", err)
	}
	defer file.Close()
	if info.Size() <= 0 || info.Size() > MaxInvoicePDFSize {
		return fmt.Errorf("invoice PDF size is invalid")
	}
	pdf, err := io.ReadAll(io.LimitReader(file, MaxInvoicePDFSize+1))
	if err != nil {
		return fmt.Errorf("read invoice PDF: %w", err)
	}
	if int64(len(pdf)) != info.Size() {
		return fmt.Errorf("invoice PDF changed while sending")
	}

	fileName := application.FileName
	if fileName == "" {
		fileName = fmt.Sprintf("invoice-%d.pdf", application.Id)
	}
	if err := common.SendEmailWithAttachment(
		fmt.Sprintf("%s invoice issued", common.SystemName),
		recipient,
		buildInvoiceEmailHTML(application, fileName),
		fileName,
		pdf,
		"application/pdf",
	); err != nil {
		return fmt.Errorf("send invoice email: %w", err)
	}
	return nil
}

func buildInvoiceEmailHTML(application model.InvoiceApplication, fileName string) string {
	issuedAt := time.Unix(application.IssuedAt, 0).Format("2006-01-02 15:04:05")
	invoiceNumber := fmt.Sprintf("INV-%08d", application.Id)
	amount := formatInvoiceAmount(application.NetAmount)
	return fmt.Sprintf(`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Invoice issued</title>
</head>
<body style="margin:0;background:#f3f6fa;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%%" style="background:#f3f6fa;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%%" style="max-width:640px;background:#ffffff;border:1px solid #e3e9f1;border-radius:12px;overflow:hidden;">
<tr><td style="padding:28px 32px;background:#15253d;color:#ffffff;">
<div style="font-size:13px;letter-spacing:1.2px;text-transform:uppercase;color:#b8c7dc;">%s</div>
<div style="font-size:26px;font-weight:700;margin-top:12px;">Invoice issued</div>
<div style="font-size:14px;line-height:1.7;color:#d7e1ee;margin-top:8px;">Your invoice is ready. The PDF is attached to this email.</div>
</td></tr>
<tr><td style="padding:32px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%%" style="border-collapse:collapse;">
<tr><td style="padding:0 0 18px;color:#718096;font-size:13px;">Invoice number</td><td align="right" style="padding:0 0 18px;font-weight:600;font-size:15px;">%s</td></tr>
<tr><td style="padding:14px 0;border-top:1px solid #edf1f5;color:#718096;font-size:13px;">Bill to</td><td align="right" style="padding:14px 0;border-top:1px solid #edf1f5;font-size:15px;">%s</td></tr>
<tr><td style="padding:14px 0;border-top:1px solid #edf1f5;color:#718096;font-size:13px;">Tax ID</td><td align="right" style="padding:14px 0;border-top:1px solid #edf1f5;font-size:15px;">%s</td></tr>
<tr><td style="padding:14px 0;border-top:1px solid #edf1f5;color:#718096;font-size:13px;">Total</td><td align="right" style="padding:14px 0;border-top:1px solid #edf1f5;color:#15253d;font-size:20px;font-weight:700;">¥ %s</td></tr>
<tr><td style="padding:14px 0 0;border-top:1px solid #edf1f5;color:#718096;font-size:13px;">Issued at</td><td align="right" style="padding:14px 0 0;font-size:15px;">%s</td></tr>
</table>
<div style="margin-top:28px;padding:16px 18px;background:#f5f8fc;border-radius:8px;color:#4a5a70;font-size:14px;line-height:1.7;">Attachment: <strong>%s</strong><br>Please download and keep the PDF. If you do not see the attachment, check your email client's attachment settings.</div>
</td></tr>
<tr><td style="padding:20px 32px 26px;border-top:1px solid #edf1f5;color:#8a96a8;font-size:12px;line-height:1.6;">This email was sent automatically by %s. Please do not reply.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
		html.EscapeString(common.SystemName),
		html.EscapeString(invoiceNumber),
		html.EscapeString(application.Title),
		html.EscapeString(application.TaxId),
		html.EscapeString(amount),
		html.EscapeString(issuedAt),
		html.EscapeString(fileName),
		html.EscapeString(common.SystemName),
	)
}

func formatInvoiceAmount(amount int64) string {
	major := amount / model.InvoiceAmountScale
	minor := amount % model.InvoiceAmountScale
	return fmt.Sprintf("%d.%02d", major, minor/10_000)
}
