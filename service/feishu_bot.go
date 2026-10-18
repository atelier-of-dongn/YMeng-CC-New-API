package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	feishuRequestTimeout   = 10 * time.Second
	feishuResponseBodySize = 64 << 10
)

var feishuWebhookHosts = []string{"open.feishu.cn", "open.larksuite.com"}

// ValidateFeishuWebhookURL only accepts Feishu/Lark custom bot webhooks.
func ValidateFeishuWebhookURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Port() != "" || parsed.User != nil ||
		!slices.Contains(feishuWebhookHosts, strings.ToLower(parsed.Hostname())) {
		return errors.New("飞书机器人地址必须是 https://open.feishu.cn 或 https://open.larksuite.com 下的 Webhook 地址")
	}
	return nil
}

// feishuSign follows the Feishu custom bot rule: HMAC-SHA256 keyed by
// "timestamp\nsecret" over an empty message, base64 encoded.
func feishuSign(timestamp int64, secret string) string {
	mac := hmac.New(sha256.New, []byte(fmt.Sprintf("%d\n%s", timestamp, secret)))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// SendFeishuPost sends a rich-text message to a Feishu custom bot.
func SendFeishuPost(ctx context.Context, webhookURL string, secret string, title string, lines []string) error {
	if err := ValidateFeishuWebhookURL(webhookURL); err != nil {
		return err
	}
	content := make([][]map[string]string, 0, len(lines))
	for _, line := range lines {
		content = append(content, []map[string]string{{"tag": "text", "text": line}})
	}
	payload := map[string]any{
		"msg_type": "post",
		"content": map[string]any{
			"post": map[string]any{
				"zh_cn": map[string]any{"title": title, "content": content},
			},
		},
	}
	if secret != "" {
		timestamp := time.Now().Unix()
		payload["timestamp"] = strconv.FormatInt(timestamp, 10)
		payload["sign"] = feishuSign(timestamp, secret)
	}
	body, err := common.Marshal(payload)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, feishuRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSpace(webhookURL), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := GetSSRFProtectedHTTPClient().Do(req)
	if err != nil {
		// url.Error embeds the webhook URL, whose path is the bot credential.
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return fmt.Errorf("飞书请求失败：%w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, feishuResponseBodySize))
	if err != nil {
		return fmt.Errorf("读取飞书响应失败：%w", err)
	}
	var result struct {
		Code          int    `json:"code"`
		Msg           string `json:"msg"`
		StatusCode    int    `json:"StatusCode"`
		StatusMessage string `json:"StatusMessage"`
	}
	_ = common.Unmarshal(respBody, &result)
	if resp.StatusCode != http.StatusOK || result.Code != 0 || result.StatusCode != 0 {
		message := result.Msg
		if message == "" {
			message = result.StatusMessage
		}
		return fmt.Errorf("飞书返回错误（HTTP %d，code %d）：%s", resp.StatusCode, result.Code, message)
	}
	return nil
}
