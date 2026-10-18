package operation_setting

import (
	"math"
	"net/url"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

type CatFKProduct struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	GoodsKey string  `json:"goods_key"`
	Amount   float64 `json:"amount"` // Expected credited balance in USD, not the selling price.
}

type CatFKChannel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

type CatFKSetting struct {
	Enabled    bool           `json:"enabled"`
	StoreToken string         `json:"store_token"`
	Products   []CatFKProduct `json:"products"`
	Channels   []CatFKChannel `json:"channels"`
}

var catfkSetting = CatFKSetting{Products: []CatFKProduct{}, Channels: []CatFKChannel{}}
var catfkProductIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
var catfkStoreTokenPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// NormalizeCatFKStoreToken accepts the public shop identifier or its canonical
// platform URL. It never accepts an administrator-selected upstream host.
func NormalizeCatFKStoreToken(value string) (string, error) {
	if len(value) > 4096 || strings.ContainsAny(value, "\r\n\x00") {
		return "", common.NewMessage("Invalid CatFK settings")
	}
	token := strings.TrimSpace(value)
	if token == "" || catfkStoreTokenPattern.MatchString(token) {
		return token, nil
	}
	u, err := url.Parse(token)
	if err != nil || u.Scheme != "https" || u.Host != "catfk.com" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" {
		return "", common.NewMessage("Invalid CatFK settings")
	}
	token, ok := strings.CutPrefix(strings.TrimSuffix(u.Path, "/"), "/shop/")
	if !ok || !catfkStoreTokenPattern.MatchString(token) {
		return "", common.NewMessage("Invalid CatFK settings")
	}
	return token, nil
}

func init() { config.GlobalConfig.Register("catfk_setting", &catfkSetting) }

func GetCatFKSetting() *CatFKSetting { return &catfkSetting }

// ValidateCatFKOption protects persisted mappings even when callers bypass the UI.
func ValidateCatFKOption(key, value string) error {
	if !strings.HasPrefix(key, "catfk_setting.") {
		return nil
	}
	switch key {
	case "catfk_setting.enabled":
		if value != "true" && value != "false" {
			return common.NewMessage("Invalid CatFK settings")
		}
	case "catfk_setting.store_token":
		if _, err := NormalizeCatFKStoreToken(value); err != nil {
			return err
		}
	case "catfk_setting.products":
		var products []CatFKProduct
		if common.UnmarshalJsonStr(value, &products) != nil || products == nil || len(products) > 100 {
			return common.NewMessage("Invalid CatFK product mappings")
		}
		ids := make(map[string]bool, len(products))
		for _, product := range products {
			if !catfkProductIDPattern.MatchString(product.ID) || ids[product.ID] || strings.TrimSpace(product.Name) == "" || len(product.Name) > 200 || strings.TrimSpace(product.GoodsKey) == "" || len(product.GoodsKey) > 512 || math.IsNaN(product.Amount) || math.IsInf(product.Amount, 0) || product.Amount <= 0 || product.Amount > 1000000 {
				return common.NewMessage("Invalid CatFK product mappings")
			}
			ids[product.ID] = true
		}
	case "catfk_setting.channels":
		var channels []CatFKChannel
		if common.UnmarshalJsonStr(value, &channels) != nil || channels == nil || len(channels) > 100 {
			return common.NewMessage("Invalid CatFK payment channels")
		}
		ids := make(map[string]bool, len(channels))
		for _, channel := range channels {
			if strings.TrimSpace(channel.ID) == "" || len(channel.ID) > 128 || ids[channel.ID] || strings.TrimSpace(channel.Name) == "" || len(channel.Name) > 200 || len(channel.Icon) > 2048 {
				return common.NewMessage("Invalid CatFK payment channels")
			}
			ids[channel.ID] = true
		}
	default:
		return common.NewMessage("Invalid CatFK settings")
	}
	return nil
}
