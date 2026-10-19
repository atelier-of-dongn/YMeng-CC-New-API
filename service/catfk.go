package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
)

var (
	ErrCatFKProtocolUnverified error = common.NewMessage("CatFK protocol is not verified")
	ErrCatFKDisabled           error = common.NewMessage("CatFK payments are disabled")
	ErrCatFKEncryptionKey      error = common.NewMessage("CatFK order encryption key is not configured")
	ErrCatFKInvalidRequest     error = common.NewMessage("Invalid CatFK payment request")
	ErrCatFKInvalidQuote       error = common.NewMessage("CatFK quote is invalid or expired")
	ErrCatFKOrderUnavailable   error = common.NewMessage("CatFK order is unavailable")
	ErrCatFKVerification       error = common.NewMessage("CatFK payment requires attention")
	ErrCatFKRedemptionPending  error = common.NewMessage("Redemption code is not available yet")
)

type CatFKQuote struct {
	QuoteID     string  `json:"quote_id"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	TopUpAmount float64 `json:"topup_amount"`
}
type CatFKPaymentRequest struct {
	ProductID      string `json:"product_id"`
	ChannelID      string `json:"channel_id"`
	QuoteID        string `json:"quote_id"`
	QQ             string `json:"qq"`
	IdempotencyKey string `json:"idempotency_key"`
}
type CatFKPayment struct {
	TradeNo       string `json:"trade_no"`
	Status        string `json:"status"`
	PaymentQRCode string `json:"payment_qr_code,omitempty"`
	FailureCode   string `json:"failure_code,omitempty"`
}
type CatFKRedemption struct {
	Key          string `json:"key"`
	Quota        int    `json:"quota"`
	RedeemedTime int64  `json:"redeemed_time"`
}
type CatFKPublicProduct struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
}
type CatFKInfo struct {
	Enabled           bool                             `json:"enabled"`
	Available         bool                             `json:"available"`
	UnavailableReason string                           `json:"unavailable_reason"`
	Products          []CatFKPublicProduct             `json:"products"`
	Channels          []operation_setting.CatFKChannel `json:"channels"`
}

// CatFKAdapter is a normalized, verified protocol boundary. These structures
// describe service invariants, not an assumed upstream wire schema.
// Production remains unavailable until the real response protocol is verified.
type CatFKAdapter interface {
	Ready() bool
	Quote(context.Context, string, string, string) (*CatFKOffer, error)
	Create(context.Context, *model.CatFKOrder, CatFKCredentials, string) (*CatFKCreatedOrder, error)
	Query(context.Context, *model.CatFKOrder, CatFKCredentials) (*CatFKOrderEvidence, error)
	Channels(context.Context, string) ([]operation_setting.CatFKChannel, error)
}
type CatFKOffer struct {
	ShopID    string
	ShopName  string
	ShopURL   string
	ProductID string
	ChannelID string
	Amount    string
	Currency  string
	Quantity  int
	InStock   bool
}
type CatFKCredentials struct {
	Visitor  string
	Cookie   string
	Password string
}
type CatFKCreatedOrder struct {
	Evidence        CatFKOrderEvidence
	UpstreamOrderID string
	PaymentURL      string
	// PaymentQRCode is read silently from the payment page; empty if unknown.
	PaymentQRCode string
	// Optional refreshed recovery credentials, encrypted before persistence.
	Credentials *CatFKCredentials
}
type CatFKOrderEvidence struct {
	UpstreamOrderID string
	ShopID          string
	ProductID       string
	ChannelID       string
	Quantity        int
	Amount          string
	Currency        string
	Paid            bool
	Delivered       bool
	Expired         bool
	RedemptionKey   string
}
type catFKUnverifiedAdapter struct{}

func (catFKUnverifiedAdapter) Ready() bool { return false }
func (catFKUnverifiedAdapter) Quote(context.Context, string, string, string) (*CatFKOffer, error) {
	return nil, ErrCatFKProtocolUnverified
}
func (catFKUnverifiedAdapter) Create(context.Context, *model.CatFKOrder, CatFKCredentials, string) (*CatFKCreatedOrder, error) {
	return nil, ErrCatFKProtocolUnverified
}
func (catFKUnverifiedAdapter) Query(context.Context, *model.CatFKOrder, CatFKCredentials) (*CatFKOrderEvidence, error) {
	return nil, ErrCatFKProtocolUnverified
}
func (catFKUnverifiedAdapter) Channels(context.Context, string) ([]operation_setting.CatFKChannel, error) {
	return nil, ErrCatFKProtocolUnverified
}

// Store operations own transactions and CAS/lease fencing. No SQL belongs here.
type catFKStore interface {
	Create(*model.CatFKOrder) (*model.CatFKOrder, bool, error)
	Get(int, string) (*model.CatFKOrder, error)
	Find(int, string) (*model.CatFKOrder, error)
	Due(int64, int) ([]*model.CatFKOrder, error)
	Claim(int, int64, int64) (*model.CatFKOrder, bool, error)
	Update(int, int64, model.CatFKOrderUpdate) (bool, error)
	Retry(int, int64, int64) (bool, error)
	Complete(int, int64, string, string) (bool, error)
	Capacity(int, int) error
}
type catFKModelStore struct{}

func (catFKModelStore) Create(o *model.CatFKOrder) (*model.CatFKOrder, bool, error) {
	return model.CreateCatFKOrder(o)
}
func (catFKModelStore) Get(u int, t string) (*model.CatFKOrder, error) {
	return model.GetCatFKOrderForUser(u, t)
}
func (catFKModelStore) Find(u int, key string) (*model.CatFKOrder, error) {
	return model.FindCatFKOrderForRequest(u, key)
}
func (catFKModelStore) Due(n int64, l int) ([]*model.CatFKOrder, error) {
	return model.ListDueCatFKOrders(n, l)
}
func (catFKModelStore) Claim(id int, n, s int64) (*model.CatFKOrder, bool, error) {
	return model.ClaimCatFKOrder(id, n, s)
}
func (catFKModelStore) Update(id int, v int64, u model.CatFKOrderUpdate) (bool, error) {
	return model.UpdateCatFKOrder(id, v, u)
}
func (catFKModelStore) Retry(id int, v, n int64) (bool, error) {
	return model.RetryCatFKOrder(id, v, n)
}
func (catFKModelStore) Complete(id int, v int64, k, ip string) (bool, error) {
	return model.CompleteVerifiedCatFKOrder(id, v, k, ip)
}
func (catFKModelStore) Capacity(u, q int) error { return model.ValidateTopUpQuotaCapacity(u, q) }

type catFKService struct {
	adapter CatFKAdapter
	store   catFKStore
	setting func() *operation_setting.CatFKSetting
	now     func() time.Time
	key     func() ([]byte, error)
}

func catFKProductionService() *catFKService {
	return &catFKService{adapter: newCatFKHTTPAdapter(), store: catFKModelStore{}, setting: operation_setting.GetCatFKSetting, now: time.Now, key: catFKEncryptionKey}
}
func CatFKProtocolReady() bool { return newCatFKHTTPAdapter().Ready() }
func CatFKUnavailableReason() string {
	if !CatFKProtocolReady() {
		return ErrCatFKProtocolUnverified.Error()
	}
	if !operation_setting.GetCatFKSetting().Enabled {
		return ErrCatFKDisabled.Error()
	}
	if _, err := catFKEncryptionKey(); err != nil {
		return ErrCatFKEncryptionKey.Error()
	}
	cfg := operation_setting.GetCatFKSetting()
	token, err := operation_setting.NormalizeCatFKStoreToken(cfg.StoreToken)
	if err != nil || token == "" || len(cfg.Products) == 0 || len(cfg.Channels) == 0 {
		return "Invalid CatFK settings"
	}
	return ""
}
func CatFKPublicInfo() CatFKInfo {
	cfg := operation_setting.GetCatFKSetting()
	info := CatFKInfo{Enabled: cfg.Enabled && operation_setting.IsPaymentComplianceConfirmed(), Available: CatFKUnavailableReason() == "", UnavailableReason: CatFKUnavailableReason(), Products: []CatFKPublicProduct{}, Channels: []operation_setting.CatFKChannel{}}
	if !operation_setting.IsPaymentComplianceConfirmed() {
		info.Available = false
		info.UnavailableReason = "Payment compliance confirmation is required"
	}
	for _, p := range cfg.Products {
		info.Products = append(info.Products, CatFKPublicProduct{ID: p.ID, Name: p.Name, Amount: p.Amount})
	}
	for _, c := range cfg.Channels {
		info.Channels = append(info.Channels, operation_setting.CatFKChannel{ID: c.ID, Name: c.Name, Icon: c.Icon})
	}
	return info
}
func QuoteCatFK(ctx context.Context, userID int, productID, channelID string) (*CatFKQuote, error) {
	q, err := catFKProductionService().quote(ctx, userID, productID, channelID)
	return q, catFKPublicError(err)
}
func CreateCatFKPayment(ctx context.Context, userID int, req CatFKPaymentRequest) (*CatFKPayment, error) {
	p, err := catFKProductionService().create(ctx, userID, req)
	return p, catFKPublicError(err)
}
func GetUserCatFKPayment(userID int, tradeNo string) (*CatFKPayment, error) {
	if userID <= 0 || tradeNo == "" {
		return nil, ErrCatFKInvalidRequest
	}
	order, err := model.GetCatFKOrderForUser(userID, tradeNo)
	if err != nil {
		return nil, ErrCatFKOrderUnavailable
	}
	return catFKSafePayment(order), nil
}

// GetUserCatFKRedemption returns the code a completed order of this user
// redeemed. The code is already used, so showing it grants nothing new.
func GetUserCatFKRedemption(userID int, tradeNo string) (*CatFKRedemption, error) {
	if userID <= 0 || tradeNo == "" {
		return nil, ErrCatFKInvalidRequest
	}
	redemption, err := model.GetCatFKRedemptionForUser(userID, tradeNo)
	if errors.Is(err, model.ErrCatFKOrderConflict) {
		return nil, ErrCatFKRedemptionPending
	}
	if err != nil {
		return nil, ErrCatFKOrderUnavailable
	}
	return &CatFKRedemption{Key: redemption.Key, Quota: redemption.Quota, RedeemedTime: redemption.RedeemedTime}, nil
}
func ListCatFKChannels(ctx context.Context, token string) ([]operation_setting.CatFKChannel, error) {
	if !CatFKProtocolReady() {
		return nil, ErrCatFKProtocolUnverified
	}
	channels, err := catFKProductionService().adapter.Channels(ctx, token)
	return channels, catFKPublicError(err)
}
func catFKSafePayment(o *model.CatFKOrder) *CatFKPayment {
	p := &CatFKPayment{TradeNo: o.TradeNo, Status: o.Status}
	switch o.FailureCode {
	case "creation_unknown", "verification_mismatch", "credential_unavailable", "settlement_failed", "delivery_invalid", "payment_regressed":
		p.FailureCode = o.FailureCode
	}
	if o.Status == model.CatFKOrderStatusPending {
		// The payment page itself is never handed out; it redirects to catfk
		// after payment. Without a scraped code, its URL is the QR content.
		p.PaymentQRCode = o.PaymentQRCode
		if p.PaymentQRCode == "" {
			p.PaymentQRCode = o.PaymentURL
		}
	}
	return p
}
func catFKEncryptionKey() ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(os.Getenv("CATFK_ORDER_ENCRYPTION_KEY"))
	if err != nil || len(key) != 32 {
		return nil, ErrCatFKEncryptionKey
	}
	return key, nil
}

// Both quote snapshots and recovery credentials use separate domain prefixes;
// credentials additionally bind the user and immutable local trade number.
func catFKSeal(key []byte, purpose string, value any) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	data, err := common.Marshal(value)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(gcm.Seal(nonce, nonce, data, []byte(purpose))), nil
}
func catFKOpen(key []byte, purpose, token string, value any) error {
	if len(token) > 32768 {
		return ErrCatFKInvalidQuote
	}
	data, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	if len(data) < gcm.NonceSize() {
		return ErrCatFKInvalidQuote
	}
	plain, err := gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], []byte(purpose))
	if err != nil {
		return err
	}
	return common.Unmarshal(plain, value)
}

type catFKQuoteSnapshot struct {
	UserID      int
	ProductID   string
	ChannelID   string
	ConfigHash  string
	ExpiresAt   int64
	Quota       int
	TopUpAmount float64
	Offer       CatFKOffer
}

func catFKConfigHash(cfg *operation_setting.CatFKSetting) string {
	data, _ := common.Marshal(cfg)
	return fmt.Sprintf("%x", sha256.Sum256(data))
}
func (s *catFKService) quote(ctx context.Context, userID int, productID, channelID string) (*CatFKQuote, error) {
	if !s.adapter.Ready() {
		return nil, ErrCatFKProtocolUnverified
	}
	cfg := s.setting()
	if !cfg.Enabled {
		return nil, ErrCatFKDisabled
	}
	key, err := s.key()
	if err != nil {
		return nil, err
	}
	if userID <= 0 {
		return nil, ErrCatFKInvalidRequest
	}
	var product *operation_setting.CatFKProduct
	for i := range cfg.Products {
		if cfg.Products[i].ID == productID {
			product = &cfg.Products[i]
			break
		}
	}
	channelOK := false
	for _, c := range cfg.Channels {
		if c.ID == channelID {
			channelOK = true
			break
		}
	}
	if product == nil || !channelOK || product.GoodsKey == "" || math.IsNaN(product.Amount) || math.IsInf(product.Amount, 0) || product.Amount <= 0 {
		return nil, ErrCatFKInvalidRequest
	}
	quota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromFloat(product.Amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	if err != nil || quota <= 0 {
		return nil, ErrCatFKInvalidRequest
	}
	if err = s.store.Capacity(userID, quota); err != nil {
		return nil, err
	}
	offer, err := s.adapter.Quote(ctx, cfg.StoreToken, product.GoodsKey, channelID)
	if err != nil {
		return nil, err
	}
	if offer == nil || offer.ShopID == "" || offer.ProductID != product.GoodsKey || offer.ChannelID != channelID || offer.Currency == "" || offer.Quantity != 1 || !offer.InStock {
		return nil, ErrCatFKVerification
	}
	amount, err := decimal.NewFromString(offer.Amount)
	if err != nil || !amount.IsPositive() {
		return nil, ErrCatFKVerification
	}
	amountFloat, _ := amount.Float64()
	if math.IsInf(amountFloat, 0) || math.IsNaN(amountFloat) {
		return nil, ErrCatFKVerification
	}
	snap := catFKQuoteSnapshot{UserID: userID, ProductID: productID, ChannelID: channelID, ConfigHash: catFKConfigHash(cfg), ExpiresAt: s.now().Add(5 * time.Minute).Unix(), Quota: quota, TopUpAmount: product.Amount, Offer: *offer}
	token, err := catFKSeal(key, "catfk/quote/v1", snap)
	if err != nil {
		return nil, err
	}
	return &CatFKQuote{QuoteID: token, Amount: amountFloat, Currency: offer.Currency, TopUpAmount: product.Amount}, nil
}
func (s *catFKService) create(ctx context.Context, userID int, req CatFKPaymentRequest) (*CatFKPayment, error) {
	if !s.adapter.Ready() {
		return nil, ErrCatFKProtocolUnverified
	}
	if userID <= 0 || req.ProductID == "" || req.ChannelID == "" || len(req.IdempotencyKey) < 16 || len(req.IdempotencyKey) > 128 || len(req.QQ) == 0 || len(req.QQ) > 32 {
		return nil, ErrCatFKInvalidRequest
	}
	for _, digit := range req.QQ {
		if digit < '0' || digit > '9' {
			return nil, ErrCatFKInvalidRequest
		}
	}
	// Recovery is account-scoped and does not depend on an expired quote,
	// disabled new purchases, or a changed shop configuration.
	existing, err := s.store.Find(userID, req.IdempotencyKey)
	if err != nil {
		return nil, ErrCatFKOrderUnavailable
	}
	if existing != nil {
		if existing.TierID != req.ProductID || existing.ChannelID != req.ChannelID {
			return nil, ErrCatFKInvalidRequest
		}
		return catFKSafePayment(existing), nil
	}
	cfg := s.setting()
	if !cfg.Enabled {
		return nil, ErrCatFKDisabled
	}
	key, err := s.key()
	if err != nil {
		return nil, err
	}
	var snap catFKQuoteSnapshot
	if err = catFKOpen(key, "catfk/quote/v1", req.QuoteID, &snap); err != nil || snap.UserID != userID || snap.ProductID != req.ProductID || snap.ChannelID != req.ChannelID || snap.ConfigHash != catFKConfigHash(cfg) || snap.ExpiresAt <= s.now().Unix() {
		return nil, ErrCatFKInvalidQuote
	}
	// Re-price immediately before persistence. A changed purchase requires a
	// new confirmation rather than silently accepting a higher upstream amount.
	fresh, err := s.adapter.Quote(ctx, cfg.StoreToken, snap.Offer.ProductID, req.ChannelID)
	if err != nil {
		return nil, err
	}
	if fresh == nil || !fresh.InStock || fresh.Quantity != 1 || fresh.ShopID != snap.Offer.ShopID || fresh.ProductID != snap.Offer.ProductID || fresh.ChannelID != snap.Offer.ChannelID || fresh.Amount != snap.Offer.Amount || fresh.Currency != snap.Offer.Currency {
		return nil, ErrCatFKInvalidQuote
	}
	if err = s.store.Capacity(userID, snap.Quota); err != nil {
		return nil, err
	}
	trade := "catfk_" + common.GetUUID()
	password := make([]byte, 32)
	if _, err = rand.Read(password); err != nil {
		return nil, err
	}
	credentials := CatFKCredentials{Visitor: common.GetUUID(), Password: base64.RawURLEncoding.EncodeToString(password)}
	ciphertext, err := catFKSeal(key, fmt.Sprintf("catfk/order/v1/%d/%s", userID, trade), credentials)
	if err != nil {
		return nil, err
	}
	order := &model.CatFKOrder{UserID: userID, TradeNo: trade, TierID: req.ProductID, ProductID: snap.Offer.ProductID, ChannelID: req.ChannelID, ExpectedQuota: snap.Quota, PriceAmount: snap.Offer.Amount, Currency: snap.Offer.Currency, ShopID: snap.Offer.ShopID, ShopName: snap.Offer.ShopName, ShopURL: snap.Offer.ShopURL, PaymentMethod: req.ChannelID, Status: model.CatFKOrderStatusNew, NextQueryAt: s.now().Unix(), CredentialCiphertext: ciphertext, IdempotencyKey: req.IdempotencyKey}
	order, alreadyExists, err := s.store.Create(order)
	if err != nil {
		return nil, ErrCatFKOrderUnavailable
	}
	if alreadyExists {
		if order.TierID != req.ProductID || order.ChannelID != req.ChannelID {
			return nil, ErrCatFKInvalidRequest
		}
		return catFKSafePayment(order), nil
	}
	claimed, ok, err := s.store.Claim(order.ID, s.now().Unix(), 120)
	if err != nil {
		return nil, err
	}
	if !ok {
		return catFKSafePayment(order), nil
	}
	// Only the creator may submit after claiming the new state. Recovery never
	// calls Create, including when a request timed out after reaching upstream.
	if claimed.Status != model.CatFKOrderStatusSubmitting {
		return catFKSafePayment(claimed), nil
	}
	createCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	result, createErr := s.adapter.Create(createCtx, claimed, credentials, req.QQ)
	cancel()
	update := model.CatFKOrderUpdate{Status: model.CatFKOrderStatusCreationUnknown, FailureCode: "creation_unknown", NextQueryAt: s.now().Add(time.Minute).Unix()}
	// A received identifier is valuable for recovery even if the verification
	// query fails. It never authorizes payment navigation or wallet credit.
	if result != nil && result.UpstreamOrderID != "" && len(result.UpstreamOrderID) <= 128 && !strings.ContainsAny(result.UpstreamOrderID, " \t\r\n\x00") {
		update.UpstreamOrderID = &result.UpstreamOrderID
		if catFKValidPaymentURL(result.PaymentURL) {
			update.PaymentURL = &result.PaymentURL
		}
	}
	// Persist refreshed cookies even when the create result is ambiguous. An
	// adapter must return any obtained recovery credentials on error as well.
	if result != nil && result.Credentials != nil {
		encrypted, sealErr := catFKSeal(key, fmt.Sprintf("catfk/order/v1/%d/%s", userID, trade), *result.Credentials)
		if sealErr != nil {
			return nil, sealErr
		}
		update.CredentialCiphertext = &encrypted
	}
	if errors.Is(createErr, ErrCatFKVerification) {
		update.Status = model.CatFKOrderStatusNeedsAttention
		update.FailureCode = "verification_mismatch"
		update.NextQueryAt = 0
	}
	if createErr == nil && result != nil && result.UpstreamOrderID != "" && catFKValidPaymentURL(result.PaymentURL) {
		if result.Evidence.UpstreamOrderID == result.UpstreamOrderID && catFKMatchesPurchase(claimed, &result.Evidence) {
			update.Status = model.CatFKOrderStatusPending
			update.FailureCode = ""
			update.UpstreamOrderID = &result.UpstreamOrderID
			update.PaymentURL = &result.PaymentURL
			if len(result.PaymentQRCode) <= 2048 && catFKValidPaymentURL(result.PaymentQRCode) {
				update.PaymentQRCode = &result.PaymentQRCode
			}
			update.NextQueryAt = s.now().Add(15 * time.Second).Unix()
		} else {
			update.Status = model.CatFKOrderStatusNeedsAttention
			update.FailureCode = "verification_mismatch"
		}
	}
	if _, err = s.store.Update(claimed.ID, claimed.Version, update); err != nil {
		return nil, err
	}
	saved, err := s.store.Get(userID, trade)
	if err != nil {
		return nil, err
	}
	return catFKSafePayment(saved), nil
}
func catFKValidPaymentURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.Fragment == ""
}

func catFKPublicError(err error) error {
	if err == nil {
		return nil
	}
	switch err {
	case ErrCatFKProtocolUnverified, ErrCatFKDisabled, ErrCatFKEncryptionKey, ErrCatFKInvalidRequest, ErrCatFKInvalidQuote, ErrCatFKVerification, ErrCatFKOrderUnavailable, ErrCatFKRedemptionPending:
		return err
	}
	return ErrCatFKOrderUnavailable
}

// catFKMatchesPurchase validates upstream trade, shop, goods, quantity and exact
// amount. Channel/currency remain local purchase metadata unless also returned
// by upstream, in which case they must match; missing fields are never invented.
func catFKMatchesPurchase(order *model.CatFKOrder, e *CatFKOrderEvidence) bool {
	actual, ae := decimal.NewFromString(e.Amount)
	expected, ee := decimal.NewFromString(order.PriceAmount)
	return e.UpstreamOrderID != "" && (order.UpstreamOrderID == nil || *order.UpstreamOrderID == e.UpstreamOrderID) && e.ShopID == order.ShopID && e.ProductID == order.ProductID && (e.ChannelID == "" || e.ChannelID == order.ChannelID) && e.Quantity == 1 && ae == nil && ee == nil && actual.IsPositive() && actual.Equal(expected) && (e.Currency == "" || e.Currency == order.Currency)
}
