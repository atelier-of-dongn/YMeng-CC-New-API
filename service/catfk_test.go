package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These fakes model external/store contracts only. Database transaction and
// redemption guarantees are exercised by model tests, not asserted by a fake.
type catFKTestAdapter struct {
	CatFKAdapter
	offer    CatFKOffer
	creates  atomic.Int32
	queries  atomic.Int32
	createFn func(*model.CatFKOrder, CatFKCredentials) (*CatFKCreatedOrder, error)
	queryFn  func(*model.CatFKOrder, CatFKCredentials) (*CatFKOrderEvidence, error)
}

func (a *catFKTestAdapter) Ready() bool { return true }
func (a *catFKTestAdapter) Quote(context.Context, string, string, string) (*CatFKOffer, error) {
	o := a.offer
	return &o, nil
}
func (a *catFKTestAdapter) Create(_ context.Context, o *model.CatFKOrder, c CatFKCredentials, _ string) (*CatFKCreatedOrder, error) {
	a.creates.Add(1)
	return a.createFn(o, c)
}
func (a *catFKTestAdapter) Query(_ context.Context, o *model.CatFKOrder, c CatFKCredentials) (*CatFKOrderEvidence, error) {
	a.queries.Add(1)
	return a.queryFn(o, c)
}

type catFKTestStore struct {
	mu          sync.Mutex
	order       *model.CatFKOrder
	completed   int
	completeErr error
	completeKey string
	updateCalls int
	loseUpdate  bool
	dueLimit    int
}

func cloneCatFK(o *model.CatFKOrder) *model.CatFKOrder {
	if o == nil {
		return nil
	}
	copy := *o
	return &copy
}
func (f *catFKTestStore) Create(o *model.CatFKOrder) (*model.CatFKOrder, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.order != nil {
		return cloneCatFK(f.order), true, nil
	}
	f.order = cloneCatFK(o)
	f.order.ID = 1
	return cloneCatFK(f.order), false, nil
}
func (f *catFKTestStore) Get(u int, t string) (*model.CatFKOrder, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.order == nil || f.order.UserID != u || f.order.TradeNo != t {
		return nil, errors.New("not found")
	}
	return cloneCatFK(f.order), nil
}
func (f *catFKTestStore) Find(u int, key string) (*model.CatFKOrder, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.order == nil || f.order.UserID != u || f.order.IdempotencyKey != key {
		return nil, nil
	}
	return cloneCatFK(f.order), nil
}
func (f *catFKTestStore) Due(_ int64, limit int) ([]*model.CatFKOrder, error) {
	f.dueLimit = limit
	return []*model.CatFKOrder{cloneCatFK(f.order)}, nil
}
func (f *catFKTestStore) Claim(_ int, now, lease int64) (*model.CatFKOrder, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.order.LeaseUntil > now {
		return cloneCatFK(f.order), false, nil
	}
	switch f.order.Status {
	case model.CatFKOrderStatusNew:
		f.order.Status = model.CatFKOrderStatusSubmitting
	case model.CatFKOrderStatusSubmitting:
		f.order.Status = model.CatFKOrderStatusCreationUnknown
	}
	f.order.Version++
	f.order.LeaseUntil = now + lease
	return cloneCatFK(f.order), true, nil
}
func (f *catFKTestStore) Update(_ int, v int64, u model.CatFKOrderUpdate) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.updateCalls++
	if f.loseUpdate || f.order.Version != v {
		return false, nil
	}
	f.order.Version++
	f.order.Status = u.Status
	f.order.NextQueryAt = u.NextQueryAt
	f.order.LeaseUntil = 0
	f.order.FailureCode = u.FailureCode
	if u.UpstreamOrderID != nil {
		f.order.UpstreamOrderID = u.UpstreamOrderID
	}
	if u.PaymentURL != nil {
		f.order.PaymentURL = *u.PaymentURL
	}
	if u.PaymentQRCode != nil {
		f.order.PaymentQRCode = *u.PaymentQRCode
	}
	if u.CredentialCiphertext != nil {
		f.order.CredentialCiphertext = *u.CredentialCiphertext
	}
	return true, nil
}
func (f *catFKTestStore) Created(id int, v int64, u, p string, n int64) (bool, error) {
	return f.Update(id, v, model.CatFKOrderUpdate{Status: model.CatFKOrderStatusPending, UpstreamOrderID: &u, PaymentURL: &p, NextQueryAt: n})
}
func (f *catFKTestStore) Retry(id int, v, n int64) (bool, error) {
	return f.Update(id, v, model.CatFKOrderUpdate{Status: f.order.Status, NextQueryAt: n})
}
func (f *catFKTestStore) Complete(_ int, v int64, k, _ string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.order.Version != v || f.order.Status != model.CatFKOrderStatusPaid {
		return false, errors.New("unfenced completion")
	}
	if f.completeErr != nil {
		return false, f.completeErr
	}
	f.completed++
	f.completeKey = k
	f.order.Status = model.CatFKOrderStatusCompleted
	return false, nil
}
func (f *catFKTestStore) Capacity(int, int) error { return nil }

func catFKFixture(t *testing.T) (*catFKService, *catFKTestAdapter, *catFKTestStore, *operation_setting.CatFKSetting) {
	t.Helper()
	cfg := &operation_setting.CatFKSetting{Enabled: true, StoreToken: "private-store-token", Products: []operation_setting.CatFKProduct{{ID: "tier", Name: "Credit", GoodsKey: "goods", Amount: 2.5}}, Channels: []operation_setting.CatFKChannel{{ID: "pay", Name: "Pay"}}}
	adapter := &catFKTestAdapter{offer: CatFKOffer{ShopID: "shop", ProductID: "goods", ChannelID: "pay", Amount: "18.00", Currency: "CNY", Quantity: 1, InStock: true}}
	store := &catFKTestStore{}
	service := &catFKService{adapter: adapter, store: store, setting: func() *operation_setting.CatFKSetting { return cfg }, now: func() time.Time { return time.Unix(1700000000, 0) }, key: func() ([]byte, error) { return make([]byte, 32), nil }}
	adapter.createFn = func(o *model.CatFKOrder, c CatFKCredentials) (*CatFKCreatedOrder, error) {
		c.Cookie = "upstream-secret-cookie"
		return &CatFKCreatedOrder{UpstreamOrderID: "upstream", PaymentURL: "https://payments.example/pay", Credentials: &c, Evidence: catFKTestEvidence(o)}, nil
	}
	adapter.queryFn = func(o *model.CatFKOrder, _ CatFKCredentials) (*CatFKOrderEvidence, error) {
		e := catFKTestEvidence(o)
		return &e, nil
	}
	return service, adapter, store, cfg
}
func catFKTestEvidence(o *model.CatFKOrder) CatFKOrderEvidence {
	return CatFKOrderEvidence{UpstreamOrderID: "upstream", ShopID: o.ShopID, ProductID: o.ProductID, ChannelID: o.ChannelID, Quantity: 1, Amount: o.PriceAmount, Currency: o.Currency, Paid: true, Delivered: true, RedemptionKey: "0123456789abcdef0123456789abcdef"}
}
func catFKRequest(t *testing.T, s *catFKService) CatFKPaymentRequest {
	t.Helper()
	q, err := s.quote(context.Background(), 7, "tier", "pay")
	require.NoError(t, err)
	assert.Equal(t, 18.0, q.Amount)
	assert.Equal(t, 2.5, q.TopUpAmount)
	return CatFKPaymentRequest{ProductID: "tier", ChannelID: "pay", QuoteID: q.QuoteID, QQ: "123456", IdempotencyKey: "stable-request-key"}
}

func TestCatFKStoreTokenAcceptsOnlyPlatformShopLinks(t *testing.T) {
	for _, input := range []string{"YMengCC", " https://catfk.com/shop/YMengCC/ "} {
		token, err := operation_setting.NormalizeCatFKStoreToken(input)
		require.NoError(t, err)
		assert.Equal(t, "YMengCC", token)
		require.NoError(t, operation_setting.ValidateCatFKOption("catfk_setting.store_token", input))
	}
	for _, input := range []string{"https://other.example/shop/YMengCC", "http://catfk.com/shop/YMengCC", "https://catfk.com:8443/shop/YMengCC", "https://catfk.com/shop/YMengCC?x=1", "https://catfk.com/shop/YMengCC#x", "YMengCC\r\n"} {
		_, err := operation_setting.NormalizeCatFKStoreToken(input)
		require.Error(t, err)
		require.Error(t, operation_setting.ValidateCatFKOption("catfk_setting.store_token", input))
	}
}

func TestCatFKUnverifiedAdapterRejectsPaymentOperations(t *testing.T) {
	assert.True(t, CatFKProtocolReady())
	// An unverified adapter still cannot touch persistence, keys or settings.
	s := &catFKService{adapter: catFKUnverifiedAdapter{}}
	_, err := s.create(context.Background(), 7, CatFKPaymentRequest{})
	require.ErrorIs(t, err, ErrCatFKProtocolUnverified)
	_, err = s.quote(context.Background(), 7, "tier", "pay")
	require.ErrorIs(t, err, ErrCatFKProtocolUnverified)
	require.ErrorIs(t, s.poll(context.Background()), ErrCatFKProtocolUnverified)
	_, err = ListCatFKChannels(context.Background(), "https://other.example/shop/secret")
	require.ErrorIs(t, err, ErrCatFKInvalidRequest)
	assert.True(t, (catFKPollHandler{}).Enabled())
	assert.Equal(t, ErrCatFKOrderUnavailable, catFKPublicError(errors.New("SQL contains sensitive value")))
}

func TestCatFKQuoteAndCreateBindings(t *testing.T) {
	for _, name := range []string{"user", "config", "expiry", "tamper", "channel", "price", "stock", "qq-empty", "qq-unicode", "qq-letter"} {
		t.Run(name, func(t *testing.T) {
			s, a, store, cfg := catFKFixture(t)
			req := catFKRequest(t, s)
			user := 7
			want := ErrCatFKInvalidQuote
			switch name {
			case "user":
				user = 8
			case "config":
				cfg.StoreToken = "changed"
			case "expiry":
				s.now = func() time.Time { return time.Unix(1700000300, 0) }
			case "tamper":
				req.QuoteID = "!" + req.QuoteID
			case "channel":
				req.ChannelID = "other"
			case "price":
				a.offer.Amount = "19"
			case "stock":
				a.offer.InStock = false
			case "qq-empty":
				req.QQ = ""
				want = ErrCatFKInvalidRequest
			case "qq-unicode":
				req.QQ = "１２３"
				want = ErrCatFKInvalidRequest
			case "qq-letter":
				req.QQ = "12a"
				want = ErrCatFKInvalidRequest
			}
			_, err := s.create(context.Background(), user, req)
			require.ErrorIs(t, err, want)
			assert.Nil(t, store.order)
			assert.Zero(t, a.creates.Load())
		})
	}
	s, a, store, _ := catFKFixture(t)
	a.offer.ProductID = "wrong"
	_, err := s.quote(context.Background(), 7, "tier", "pay")
	require.ErrorIs(t, err, ErrCatFKVerification)
	assert.Nil(t, store.order)
}

func TestCatFKCreateOnceAndCredentialRecovery(t *testing.T) {
	s, a, store, _ := catFKFixture(t)
	req := catFKRequest(t, s)
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		wg.Go(func() { _, err := s.create(context.Background(), 7, req); errs <- err })
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	assert.EqualValues(t, 1, a.creates.Load())
	require.NotNil(t, store.order)
	assert.Equal(t, model.CatFKOrderStatusPending, store.order.Status)
	var credentials CatFKCredentials
	key, err := s.key()
	require.NoError(t, err)
	purpose := fmt.Sprintf("catfk/order/v1/%d/%s", 7, store.order.TradeNo)
	require.NoError(t, catFKOpen(key, purpose, store.order.CredentialCiphertext, &credentials))
	assert.Equal(t, "upstream-secret-cookie", credentials.Cookie)
	assert.NotEmpty(t, credentials.Visitor)
	assert.NotEmpty(t, credentials.Password)
	require.Error(t, catFKOpen(key, purpose+"other", store.order.CredentialCiphertext, &credentials))
	public, err := common.Marshal(catFKSafePayment(store.order))
	require.NoError(t, err)
	assert.NotContains(t, string(public), credentials.Cookie)
	assert.NotContains(t, string(public), credentials.Password)
	assert.NotContains(t, string(public), "0123456789abcdef0123456789abcdef")
	t.Setenv("CATFK_ORDER_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	restartedKey, err := catFKEncryptionKey()
	require.NoError(t, err)
	require.NoError(t, catFKOpen(restartedKey, purpose, store.order.CredentialCiphertext, &credentials))
	store.order.Status = model.CatFKOrderStatusCompleted
	assert.Empty(t, catFKSafePayment(store.order).PaymentQRCode)
}

func TestCatFKAmbiguousCreationNeverResubmits(t *testing.T) {
	s, a, store, cfg := catFKFixture(t)
	req := catFKRequest(t, s)
	a.createFn = func(_ *model.CatFKOrder, c CatFKCredentials) (*CatFKCreatedOrder, error) {
		c.Cookie = "recover-cookie"
		return &CatFKCreatedOrder{Credentials: &c}, context.DeadlineExceeded
	}
	payment, err := s.create(context.Background(), 7, req)
	require.NoError(t, err)
	assert.Equal(t, model.CatFKOrderStatusCreationUnknown, payment.Status)
	assert.Empty(t, payment.PaymentQRCode)
	_, err = s.create(context.Background(), 7, req)
	require.NoError(t, err)
	assert.EqualValues(t, 1, a.creates.Load())
	cfg.Enabled = false // Recovery intentionally ignores the new-purchase switch.
	require.NoError(t, s.poll(context.Background()))
	assert.Equal(t, model.CatFKOrderStatusCompleted, store.order.Status)
	assert.Equal(t, 1, store.completed)
	assert.Equal(t, "0123456789abcdef0123456789abcdef", store.completeKey)
	assert.Equal(t, 50, store.dueLimit)
	assert.EqualValues(t, 1, a.creates.Load())
}

func TestCatFKExistingRequestSurvivesQuoteExpiryAndDisabledPurchases(t *testing.T) {
	s, a, store, cfg := catFKFixture(t)
	req := catFKRequest(t, s)
	first, err := s.create(context.Background(), 7, req)
	require.NoError(t, err)
	cfg.Enabled = false
	cfg.StoreToken = "changed-shop"
	s.now = func() time.Time { return time.Unix(1700000600, 0) }
	recovered, err := s.create(context.Background(), 7, req)
	require.NoError(t, err)
	assert.Equal(t, first, recovered)
	assert.EqualValues(t, 1, a.creates.Load())
	assert.Equal(t, first.TradeNo, store.order.TradeNo)

	req.ChannelID = "different-channel"
	_, err = s.create(context.Background(), 7, req)
	require.ErrorIs(t, err, ErrCatFKInvalidRequest)
	assert.EqualValues(t, 1, a.creates.Load())
}

func TestCatFKPartialCreationRetainsRecoveryIdentity(t *testing.T) {
	s, a, store, _ := catFKFixture(t)
	req := catFKRequest(t, s)
	a.createFn = func(_ *model.CatFKOrder, c CatFKCredentials) (*CatFKCreatedOrder, error) {
		c.Cookie = "recovery-cookie"
		return &CatFKCreatedOrder{UpstreamOrderID: "known-upstream", Credentials: &c}, context.DeadlineExceeded
	}
	payment, err := s.create(context.Background(), 7, req)
	require.NoError(t, err)
	assert.Equal(t, model.CatFKOrderStatusCreationUnknown, payment.Status)
	require.NotNil(t, store.order.UpstreamOrderID)
	assert.Equal(t, "known-upstream", *store.order.UpstreamOrderID)
	assert.Empty(t, payment.PaymentQRCode)
	_, err = s.create(context.Background(), 7, req)
	require.NoError(t, err)
	assert.EqualValues(t, 1, a.creates.Load())
}

func TestCatFKCreationSnapshotMismatch(t *testing.T) {
	s, a, store, _ := catFKFixture(t)
	req := catFKRequest(t, s)
	a.createFn = func(o *model.CatFKOrder, _ CatFKCredentials) (*CatFKCreatedOrder, error) {
		e := catFKTestEvidence(o)
		e.Amount = "0.01"
		return &CatFKCreatedOrder{UpstreamOrderID: "upstream", PaymentURL: "https://payments.example/pay", Evidence: e}, nil
	}
	p, err := s.create(context.Background(), 7, req)
	require.NoError(t, err)
	assert.Equal(t, model.CatFKOrderStatusNeedsAttention, p.Status)
	assert.Empty(t, p.PaymentQRCode)
	assert.Zero(t, store.completed)
}

func TestCatFKPendingOrderExposesOnlyTheScrapedQRCode(t *testing.T) {
	for _, tc := range []struct{ name, scraped, want string }{
		{"scraped", "https://qr.alipay.com/upx-code", "https://qr.alipay.com/upx-code"},
		{"unsafe-scrape", "javascript:alert(1)", "https://payments.example/pay"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, a, store, _ := catFKFixture(t)
			req := catFKRequest(t, s)
			a.createFn = func(o *model.CatFKOrder, _ CatFKCredentials) (*CatFKCreatedOrder, error) {
				e := catFKTestEvidence(o)
				e.Paid, e.Delivered, e.RedemptionKey = false, false, ""
				return &CatFKCreatedOrder{UpstreamOrderID: "upstream", PaymentURL: "https://payments.example/pay", PaymentQRCode: tc.scraped, Evidence: e}, nil
			}
			payment, err := s.create(context.Background(), 7, req)
			require.NoError(t, err)
			assert.Equal(t, model.CatFKOrderStatusPending, payment.Status)
			assert.Equal(t, tc.want, payment.PaymentQRCode)
			public, err := common.Marshal(payment)
			require.NoError(t, err)
			assert.NotContains(t, string(public), "payment_url")
			store.order.Status = model.CatFKOrderStatusExpired
			assert.Empty(t, catFKSafePayment(store.order).PaymentQRCode)
		})
	}
}

func TestCatFKRefreshSettlesAWatchedOrderWithoutWaitingForThePoll(t *testing.T) {
	s, a, store, _ := catFKFixture(t)
	req := catFKRequest(t, s)
	a.createFn = func(o *model.CatFKOrder, _ CatFKCredentials) (*CatFKCreatedOrder, error) {
		e := catFKTestEvidence(o)
		e.Paid, e.Delivered, e.RedemptionKey = false, false, ""
		return &CatFKCreatedOrder{UpstreamOrderID: "upstream", PaymentURL: "https://payments.example/pay", Evidence: e}, nil
	}
	payment, err := s.create(context.Background(), 7, req)
	require.NoError(t, err)
	require.Equal(t, model.CatFKOrderStatusPending, payment.Status)
	require.Greater(t, store.order.NextQueryAt, s.now().Unix(), "the background poll is not due yet")

	store.order.UpdatedAt = s.now().Unix()
	order, err := s.refresh(context.Background(), 7, payment.TradeNo)
	require.NoError(t, err)
	assert.Equal(t, model.CatFKOrderStatusPending, order.Status)
	assert.Zero(t, a.queries.Load(), "a just-updated order is not queried again")

	store.order.UpdatedAt = s.now().Unix() - 2
	order, err = s.refresh(context.Background(), 7, payment.TradeNo)
	require.NoError(t, err)
	assert.Equal(t, model.CatFKOrderStatusCompleted, order.Status)
	assert.EqualValues(t, 1, a.queries.Load())
	assert.Equal(t, 1, store.completed)

	order, err = s.refresh(context.Background(), 7, payment.TradeNo)
	require.NoError(t, err)
	assert.Equal(t, model.CatFKOrderStatusCompleted, order.Status)
	assert.EqualValues(t, 1, a.queries.Load(), "a finished order is never queried")
	_, err = s.refresh(context.Background(), 8, payment.TradeNo)
	require.Error(t, err)
}

func TestCatFKQuoteShowsTheIncludedFeeOnlyWhenItAddsUp(t *testing.T) {
	for _, tc := range []struct {
		name, original, fee string
		wantFee, wantRate   *float64
	}{
		{"breakdown", "10", "0.18", new(0.18), new(1.8)},
		{"no-fee", "10.18", "0", new(0.0), new(0.0)},
		{"inconsistent", "10", "0.5", nil, nil},
		{"unknown", "", "", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, a, _, _ := catFKFixture(t)
			a.offer.Amount, a.offer.OriginalAmount, a.offer.Fee = "10.18", tc.original, tc.fee
			q, err := s.quote(context.Background(), 7, "tier", "pay")
			require.NoError(t, err)
			assert.Equal(t, 10.18, q.Amount)
			assert.Equal(t, tc.wantFee, q.Fee)
			assert.Equal(t, tc.wantRate, q.FeeRate)
		})
	}
}

func TestCatFKDocumentedReceiptCanSettleOnlyTheBoundPurchase(t *testing.T) {
	s, a, store, _ := catFKFixture(t)
	req := catFKRequest(t, s)
	a.createFn = func(o *model.CatFKOrder, _ CatFKCredentials) (*CatFKCreatedOrder, error) {
		e := catFKTestEvidence(o)
		e.ChannelID, e.Currency = "", ""
		e.Paid, e.Delivered, e.RedemptionKey = false, false, ""
		return &CatFKCreatedOrder{UpstreamOrderID: "upstream", PaymentURL: "https://payments.example/pay", Evidence: e}, nil
	}
	payment, err := s.create(context.Background(), 7, req)
	require.NoError(t, err)
	assert.Equal(t, model.CatFKOrderStatusPending, payment.Status)
	assert.Equal(t, "https://payments.example/pay", payment.PaymentQRCode, "without a scraped code the payment URL is the QR content")
	assert.Zero(t, store.completed)
	a.queryFn = func(o *model.CatFKOrder, _ CatFKCredentials) (*CatFKOrderEvidence, error) {
		e := catFKTestEvidence(o)
		e.ChannelID, e.Currency = "", ""
		return &e, nil
	}
	require.NoError(t, s.poll(context.Background()))
	assert.Equal(t, model.CatFKOrderStatusCompleted, store.order.Status)
	assert.Equal(t, 7, store.order.UserID)
	assert.Equal(t, 1, store.completed)
}

func TestCatFKSettlementRequiresCompleteEvidence(t *testing.T) {
	cases := []struct {
		name   string
		change func(*CatFKOrderEvidence)
	}{
		{"upstream", func(e *CatFKOrderEvidence) { e.UpstreamOrderID = "other" }},
		{"shop", func(e *CatFKOrderEvidence) { e.ShopID = "other" }},
		{"product", func(e *CatFKOrderEvidence) { e.ProductID = "other" }},
		{"channel", func(e *CatFKOrderEvidence) { e.ChannelID = "other" }},
		{"quantity", func(e *CatFKOrderEvidence) { e.Quantity = 2 }},
		{"amount", func(e *CatFKOrderEvidence) { e.Amount = "17.99" }},
		{"currency", func(e *CatFKOrderEvidence) { e.Currency = "USD" }},
		{"unpaid", func(e *CatFKOrderEvidence) { e.Paid = false }},
		{"undelivered", func(e *CatFKOrderEvidence) { e.Delivered = false }},
		{"missing-code", func(e *CatFKOrderEvidence) { e.RedemptionKey = "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _, store, _ := catFKFixture(t)
			req := catFKRequest(t, s)
			_, err := s.create(context.Background(), 7, req)
			require.NoError(t, err)
			order := cloneCatFK(store.order)
			e := catFKTestEvidence(order)
			tc.change(&e)
			require.NoError(t, s.applyEvidence(order, &e))
			assert.Zero(t, store.completed)
		})
	}
	t.Run("stale CAS cannot settle", func(t *testing.T) {
		s, _, store, _ := catFKFixture(t)
		req := catFKRequest(t, s)
		_, err := s.create(context.Background(), 7, req)
		require.NoError(t, err)
		store.loseUpdate = true
		e := catFKTestEvidence(store.order)
		require.NoError(t, s.applyEvidence(cloneCatFK(store.order), &e))
		assert.Zero(t, store.completed)
	})
}

func TestCatFKPollRecoversSubmittingWithoutCreate(t *testing.T) {
	s, a, store, _ := catFKFixture(t)
	req := catFKRequest(t, s)
	_, err := s.create(context.Background(), 7, req)
	require.NoError(t, err)
	store.order.Status = model.CatFKOrderStatusSubmitting
	store.order.LeaseUntil = 0
	a.queryFn = func(_ *model.CatFKOrder, _ CatFKCredentials) (*CatFKOrderEvidence, error) {
		return nil, errors.New("temporary upstream failure")
	}
	require.NoError(t, s.poll(context.Background()))
	assert.Equal(t, model.CatFKOrderStatusCreationUnknown, store.order.Status)
	assert.Greater(t, store.order.NextQueryAt, s.now().Unix())
	assert.EqualValues(t, 1, a.creates.Load())
	assert.Zero(t, store.completed)
}

func TestCatFKLatePaymentRecoveryDoesNotWaitForOldOrderVersion(t *testing.T) {
	for _, status := range []string{model.CatFKOrderStatusPending, model.CatFKOrderStatusPaid} {
		t.Run(status, func(t *testing.T) {
			s, a, store, _ := catFKFixture(t)
			_, err := s.create(context.Background(), 7, catFKRequest(t, s))
			require.NoError(t, err)
			store.order.Status = status
			store.order.Version = 100
			started := s.now()
			a.queryFn = func(*model.CatFKOrder, CatFKCredentials) (*CatFKOrderEvidence, error) {
				return nil, errors.New("temporary query failure after waiting for payment")
			}
			require.NoError(t, s.poll(context.Background()))
			assert.LessOrEqual(t, store.order.NextQueryAt-started.Unix(), int64(60), "one transient failure must not postpone a late payment for fifteen minutes")
			assert.Zero(t, store.completed)
			s.now = func() time.Time { return started.Add(time.Minute) }
			a.queryFn = func(o *model.CatFKOrder, _ CatFKCredentials) (*CatFKOrderEvidence, error) {
				e := catFKTestEvidence(o)
				return &e, nil
			}
			require.NoError(t, s.poll(context.Background()))
			assert.Equal(t, model.CatFKOrderStatusCompleted, store.order.Status)
			assert.Equal(t, 1, store.completed)
			assert.EqualValues(t, 1, a.creates.Load())
		})
	}
}

func TestCatFKPendingPaymentAndDeliveryRecheckPromptly(t *testing.T) {
	for _, paid := range []bool{false, true} {
		t.Run(fmt.Sprintf("paid=%t", paid), func(t *testing.T) {
			s, a, store, _ := catFKFixture(t)
			_, err := s.create(context.Background(), 7, catFKRequest(t, s))
			require.NoError(t, err)
			a.queryFn = func(o *model.CatFKOrder, _ CatFKCredentials) (*CatFKOrderEvidence, error) {
				e := catFKTestEvidence(o)
				e.Paid, e.Delivered = paid, false
				return &e, nil
			}
			require.NoError(t, s.poll(context.Background()))
			assert.Equal(t, s.now().Add(15*time.Second).Unix(), store.order.NextQueryAt)
			assert.Zero(t, store.completed)
		})
	}
}

func TestCatFKQueryVerificationFailureRequiresAttention(t *testing.T) {
	s, a, store, _ := catFKFixture(t)
	req := catFKRequest(t, s)
	_, err := s.create(context.Background(), 7, req)
	require.NoError(t, err)
	a.queryFn = func(_ *model.CatFKOrder, _ CatFKCredentials) (*CatFKOrderEvidence, error) {
		return nil, ErrCatFKVerification
	}
	require.NoError(t, s.poll(context.Background()))
	assert.Equal(t, model.CatFKOrderStatusNeedsAttention, store.order.Status)
	assert.Equal(t, "verification_mismatch", store.order.FailureCode)
	assert.Zero(t, store.completed)
}

func TestCatFKPaidOrderWaitsForDeliveryAndRetriesTransientSettlement(t *testing.T) {
	s, _, store, _ := catFKFixture(t)
	req := catFKRequest(t, s)
	_, err := s.create(context.Background(), 7, req)
	require.NoError(t, err)
	evidence := catFKTestEvidence(store.order)
	evidence.Delivered = false
	evidence.Expired = true
	require.NoError(t, s.applyEvidence(cloneCatFK(store.order), &evidence))
	assert.Equal(t, model.CatFKOrderStatusPaid, store.order.Status)
	assert.Zero(t, store.completed)
	require.NoError(t, s.applyEvidence(cloneCatFK(store.order), &evidence))
	assert.Equal(t, model.CatFKOrderStatusPaid, store.order.Status)
	evidence.Delivered = true
	store.completeErr = model.ErrRedemptionDatabase
	require.NoError(t, s.applyEvidence(cloneCatFK(store.order), &evidence))
	assert.Equal(t, model.CatFKOrderStatusPaid, store.order.Status)
	assert.Greater(t, store.order.NextQueryAt, s.now().Unix())
	assert.Zero(t, store.completed)
	store.completeErr = model.ErrRedemptionQuotaMismatch
	require.NoError(t, s.applyEvidence(cloneCatFK(store.order), &evidence))
	assert.Equal(t, model.CatFKOrderStatusNeedsAttention, store.order.Status)
	assert.Zero(t, store.completed)
}

func TestCatFKRejectsEmbeddedOrMultipleCodes(t *testing.T) {
	for _, code := range []string{"prefix 0123456789abcdef0123456789abcdef", "0123456789abcdef0123456789abcdef\n0123456789abcdef0123456789abcdef", "0123456789abcdef0123456789abcdeg"} {
		s, _, store, _ := catFKFixture(t)
		req := catFKRequest(t, s)
		_, err := s.create(context.Background(), 7, req)
		require.NoError(t, err)
		evidence := catFKTestEvidence(store.order)
		evidence.RedemptionKey = code
		require.NoError(t, s.applyEvidence(cloneCatFK(store.order), &evidence))
		assert.Equal(t, "delivery_invalid", store.order.FailureCode)
		assert.Zero(t, store.completed)
	}
}
