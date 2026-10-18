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

func TestCatFKProductionRemainsUnavailable(t *testing.T) {
	assert.False(t, CatFKProtocolReady())
	assert.Equal(t, ErrCatFKProtocolUnverified.Error(), CatFKUnavailableReason())
	// Nil dependencies deliberately prove that neither persistence nor upstream
	// nor even key/config lookup is touched before the production protocol gate.
	s := &catFKService{adapter: catFKUnverifiedAdapter{}}
	_, err := s.create(context.Background(), 7, CatFKPaymentRequest{})
	require.ErrorIs(t, err, ErrCatFKProtocolUnverified)
	_, err = s.quote(context.Background(), 7, "tier", "pay")
	require.ErrorIs(t, err, ErrCatFKProtocolUnverified)
	require.ErrorIs(t, s.poll(context.Background()), ErrCatFKProtocolUnverified)
	_, err = ListCatFKChannels(context.Background(), "secret")
	require.ErrorIs(t, err, ErrCatFKProtocolUnverified)
	assert.False(t, (catFKPollHandler{}).Enabled())
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
	assert.Empty(t, catFKSafePayment(store.order).PaymentURL)
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
	assert.Empty(t, payment.PaymentURL)
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
	assert.Empty(t, p.PaymentURL)
	assert.Zero(t, store.completed)
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
