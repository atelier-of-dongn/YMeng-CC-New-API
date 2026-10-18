package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

const (
	CatFKOrderStatusNew             = "new"
	CatFKOrderStatusSubmitting      = "submitting"
	CatFKOrderStatusCreationUnknown = "creation_unknown"
	CatFKOrderStatusPending         = "pending"
	CatFKOrderStatusPaid            = "paid"
	CatFKOrderStatusNeedsAttention  = "needs_attention"
	CatFKOrderStatusCompleted       = "completed"
	CatFKOrderStatusExpired         = "expired"
)

var ErrCatFKOrderConflict = errors.New("catfk order changed or is not eligible")

// CatFKOrder contains immutable server-selected purchase/account snapshots.
// CredentialCiphertext must contain authenticated encryption, never a raw code.
// UpstreamOrderID is shop-scoped; NULL means no upstream order is bound yet.
// Service callers must return an explicit public DTO rather than this record.
type CatFKOrder struct {
	ID                   int     `json:"id"`
	TopUpID              int     `json:"topup_id" gorm:"uniqueIndex;not null"`
	UserID               int     `json:"user_id" gorm:"index;uniqueIndex:idx_catfk_user_idempotency,priority:1;not null"`
	TradeNo              string  `json:"trade_no" gorm:"type:varchar(191);uniqueIndex;not null"`
	TierID               string  `json:"tier_id" gorm:"type:varchar(191);not null"`
	ProductID            string  `json:"product_id" gorm:"type:varchar(191);not null"`
	ChannelID            string  `json:"channel_id" gorm:"type:varchar(191);not null"`
	ExpectedQuota        int     `json:"expected_quota" gorm:"not null"`
	PriceAmount          string  `json:"price_amount" gorm:"type:varchar(64);not null"`
	Currency             string  `json:"currency" gorm:"type:varchar(16);not null"`
	ShopID               string  `json:"-" gorm:"type:varchar(128);uniqueIndex:idx_catfk_shop_upstream,priority:1;not null"`
	ShopName             string  `json:"shop_name" gorm:"type:varchar(255)"`
	ShopURL              string  `json:"-" gorm:"type:text"`
	PaymentMethod        string  `json:"payment_method" gorm:"type:varchar(50)"`
	PaymentURL           string  `json:"payment_url" gorm:"type:text"`
	UpstreamOrderID      *string `json:"-" gorm:"type:varchar(128);uniqueIndex:idx_catfk_shop_upstream,priority:2"`
	RedemptionID         *int    `json:"-" gorm:"uniqueIndex"`
	Status               string  `json:"status" gorm:"type:varchar(32);index:idx_catfk_due,priority:1;not null"`
	NextQueryAt          int64   `json:"-" gorm:"index:idx_catfk_due,priority:2;not null"`
	LeaseUntil           int64   `json:"-" gorm:"not null"`
	Version              int64   `json:"-" gorm:"not null"`
	CredentialCiphertext string  `json:"-" gorm:"type:text"`
	IdempotencyKey       string  `json:"-" gorm:"type:varchar(191);uniqueIndex:idx_catfk_user_idempotency,priority:2;not null"`
	FailureCode          string  `json:"failure_code" gorm:"type:varchar(64)"`
	CreatedAt            int64   `json:"created_at" gorm:"autoCreateTime:false;not null"`
	UpdatedAt            int64   `json:"updated_at" gorm:"autoUpdateTime:false;not null"`
}

// CreateCatFKOrder atomically creates a TopUp and its detail. The service sets
// UserID from the authenticated session, never a client-supplied account ID.
// Repeating a user's idempotency key returns the original immutable purchase.
func CreateCatFKOrder(order *CatFKOrder) (existing *CatFKOrder, alreadyExists bool, err error) {
	if order == nil || order.UserID <= 0 || order.IdempotencyKey == "" || len(order.IdempotencyKey) > 191 {
		return nil, false, errors.New("invalid catfk order identity")
	}
	existing = &CatFKOrder{}
	if lookupErr := DB.Where("user_id = ? AND idempotency_key = ?", order.UserID, order.IdempotencyKey).First(existing).Error; lookupErr == nil {
		return existing, true, nil
	} else if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return nil, false, lookupErr
	}
	price, priceErr := decimal.NewFromString(order.PriceAmount)
	if order.ID != 0 || order.TopUpID != 0 || order.TradeNo == "" || len(order.TradeNo) > 191 || order.TierID == "" || order.ProductID == "" || order.ChannelID == "" || order.ShopID == "" || len(order.ShopID) > 128 || order.Currency == "" || len(order.Currency) > 16 || priceErr != nil || !price.IsPositive() || len(order.PriceAmount) > 64 || strings.ContainsAny(order.PriceAmount, "eE") || len(order.TierID) > 191 || len(order.ProductID) > 191 || len(order.ChannelID) > 191 || len(order.ShopName) > 255 {
		return nil, false, errors.New("invalid catfk purchase snapshot")
	}
	if order.ExpectedQuota <= 0 || common.ValidateWalletQuota(order.ExpectedQuota) != nil {
		return nil, false, ErrInvalidTopUpQuota
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Select("id").Where("id = ?", order.UserID).First(&user).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		money, _ := price.Float64()
		topup := &TopUp{UserId: order.UserID, TradeNo: order.TradeNo, Money: money, Amount: int64(order.ExpectedQuota), PaymentMethod: PaymentMethodCatFK, PaymentProvider: PaymentProviderCatFK, Status: common.TopUpStatusPending, CreateTime: now}
		if err := tx.Create(topup).Error; err != nil {
			return err
		}
		order.TopUpID = topup.Id
		order.PaymentMethod = PaymentMethodCatFK
		order.Status = CatFKOrderStatusNew
		order.UpstreamOrderID, order.RedemptionID = nil, nil
		order.PaymentURL, order.FailureCode = "", ""
		order.Version, order.LeaseUntil = 0, 0
		order.NextQueryAt, order.CreatedAt, order.UpdatedAt = now, now, now
		return tx.Session(&gorm.Session{Logger: tx.Logger.LogMode(gormlogger.Silent)}).Create(order).Error
	})
	if err != nil {
		// A competing request can win the unique constraint after our lookup.
		existing = &CatFKOrder{}
		if lookupErr := DB.Where("user_id = ? AND idempotency_key = ?", order.UserID, order.IdempotencyKey).First(existing).Error; lookupErr == nil {
			return existing, true, nil
		}
		return nil, false, err
	}
	return order, false, nil
}

func GetCatFKOrderByTradeNo(tradeNo string) (*CatFKOrder, error) {
	order := &CatFKOrder{}
	err := DB.Where("trade_no = ?", tradeNo).First(order).Error
	return order, err
}

func GetCatFKOrderForUser(userID int, tradeNo string) (*CatFKOrder, error) {
	order := &CatFKOrder{}
	err := DB.Where("user_id = ? AND trade_no = ?", userID, tradeNo).First(order).Error
	return order, err
}

// FindCatFKOrderForRequest recovers a persisted purchase before revalidating a
// quote or current settings. A retry must not create a different purchase.
func FindCatFKOrderForRequest(userID int, idempotencyKey string) (*CatFKOrder, error) {
	order := &CatFKOrder{}
	err := DB.Where("user_id = ? AND idempotency_key = ?", userID, idempotencyKey).First(order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return order, err
}

func ListDueCatFKOrders(now int64, limit int) ([]*CatFKOrder, error) {
	orders := make([]*CatFKOrder, 0)
	if limit <= 0 || limit > 1000 {
		return nil, errors.New("invalid catfk query limit")
	}
	err := DB.Where("status IN ? AND next_query_at <= ? AND lease_until <= ?", []string{CatFKOrderStatusNew, CatFKOrderStatusSubmitting, CatFKOrderStatusCreationUnknown, CatFKOrderStatusPending, CatFKOrderStatusPaid}, now, now).Order("next_query_at, id").Limit(limit).Find(&orders).Error
	return orders, err
}

// ClaimCatFKOrder grants a bounded lease by CAS. Only New may submit a create
// request. A recovered Submitting becomes CreationUnknown and MUST be queried;
// the service must never replay an ambiguous upstream creation.
func ClaimCatFKOrder(id int, now int64, leaseSeconds int64) (*CatFKOrder, bool, error) {
	if id <= 0 || now <= 0 || leaseSeconds <= 0 || leaseSeconds > 3600 || now > (1<<63-1)-leaseSeconds {
		return nil, false, errors.New("invalid catfk claim")
	}
	order := &CatFKOrder{}
	if err := DB.First(order, "id = ?", id).Error; err != nil {
		return nil, false, err
	}
	status := order.Status
	switch status {
	case CatFKOrderStatusNew:
		status = CatFKOrderStatusSubmitting
	case CatFKOrderStatusSubmitting:
		status = CatFKOrderStatusCreationUnknown
	case CatFKOrderStatusCreationUnknown, CatFKOrderStatusPending, CatFKOrderStatusPaid:
	default:
		return order, false, nil
	}
	result := DB.Model(&CatFKOrder{}).Where("id = ? AND version = ? AND status = ? AND next_query_at <= ? AND lease_until <= ?", id, order.Version, order.Status, now, now).Updates(map[string]any{"status": status, "lease_until": now + leaseSeconds, "version": gorm.Expr("version + 1"), "updated_at": now})
	if result.Error != nil || result.RowsAffected != 1 {
		return order, false, result.Error
	}
	order.Status, order.LeaseUntil, order.UpdatedAt = status, now+leaseSeconds, now
	order.Version++
	return order, true, nil
}

// CatFKOrderUpdate contains only verified service results. It intentionally
// cannot change the account, purchase snapshot, redemption, or terminal success.
// FailureCode is a fixed internal category; never put upstream messages in it.
type CatFKOrderUpdate struct {
	Status               string
	UpstreamOrderID      *string
	PaymentURL           *string
	CredentialCiphertext *string
	NextQueryAt          int64
	FailureCode          string
}

func MarkCatFKOrderCreated(id int, version int64, upstreamID string, paymentURL string, nextQueryAt int64) (bool, error) {
	return UpdateCatFKOrder(id, version, CatFKOrderUpdate{Status: CatFKOrderStatusPending, UpstreamOrderID: &upstreamID, PaymentURL: &paymentURL, NextQueryAt: nextQueryAt})
}

func UpdateCatFKOrder(id int, version int64, update CatFKOrderUpdate) (bool, error) {
	order := &CatFKOrder{}
	if err := DB.First(order, "id = ?", id).Error; err != nil {
		return false, err
	}
	if order.Version != version {
		return false, nil
	}
	allowed := false
	switch order.Status {
	case CatFKOrderStatusSubmitting, CatFKOrderStatusCreationUnknown:
		allowed = update.Status == order.Status || update.Status == CatFKOrderStatusCreationUnknown || update.Status == CatFKOrderStatusPending || update.Status == CatFKOrderStatusNeedsAttention || update.Status == CatFKOrderStatusExpired
	case CatFKOrderStatusPending:
		allowed = update.Status == CatFKOrderStatusPending || update.Status == CatFKOrderStatusPaid || update.Status == CatFKOrderStatusNeedsAttention || update.Status == CatFKOrderStatusExpired
	case CatFKOrderStatusPaid:
		allowed = update.Status == CatFKOrderStatusPaid || update.Status == CatFKOrderStatusNeedsAttention
	}
	if !allowed || update.NextQueryAt < 0 || len(update.FailureCode) > 64 || strings.ContainsAny(update.FailureCode, " \t\r\n") {
		return false, ErrCatFKOrderConflict
	}
	upstreamID := order.UpstreamOrderID
	if update.UpstreamOrderID != nil {
		if *update.UpstreamOrderID == "" || len(*update.UpstreamOrderID) > 128 || (upstreamID != nil && *upstreamID != *update.UpstreamOrderID) {
			return false, ErrCatFKOrderConflict
		}
		upstreamID = update.UpstreamOrderID
	}
	if (update.Status == CatFKOrderStatusPending || update.Status == CatFKOrderStatusPaid) && upstreamID == nil {
		return false, ErrCatFKOrderConflict
	}
	fields := map[string]any{"status": update.Status, "next_query_at": update.NextQueryAt, "failure_code": update.FailureCode, "lease_until": 0, "version": gorm.Expr("version + 1"), "updated_at": common.GetTimestamp()}
	if update.UpstreamOrderID != nil {
		fields["upstream_order_id"] = *update.UpstreamOrderID
	}
	if update.PaymentURL != nil {
		fields["payment_url"] = *update.PaymentURL
	}
	if update.CredentialCiphertext != nil {
		fields["credential_ciphertext"] = *update.CredentialCiphertext
	}
	// SQL logger must not print encrypted credentials or provider responses.
	result := DB.Session(&gorm.Session{Logger: DB.Logger.LogMode(gormlogger.Silent)}).Model(&CatFKOrder{}).Where("id = ? AND version = ? AND status = ?", id, version, order.Status).Updates(fields)
	return result.RowsAffected == 1, result.Error
}

func RetryCatFKOrder(id int, version int64, nextQueryAt int64) (bool, error) {
	if nextQueryAt <= 0 {
		return false, errors.New("invalid catfk retry time")
	}
	result := DB.Model(&CatFKOrder{}).Where("id = ? AND version = ? AND status IN ?", id, version, []string{CatFKOrderStatusSubmitting, CatFKOrderStatusCreationUnknown, CatFKOrderStatusPending, CatFKOrderStatusPaid}).Updates(map[string]any{"next_query_at": nextQueryAt, "lease_until": 0, "version": gorm.Expr("version + 1"), "updated_at": common.GetTimestamp()})
	return result.RowsAffected == 1, result.Error
}

// CompleteVerifiedCatFKOrder is an internal service boundary, NEVER a handler
// for client-supplied redemption codes. Before calling, the service must verify
// provider identity, paid status, shop/product/channel/currency/price snapshots,
// and exactly one local code from an authenticated upstream result. The model
// independently enforces paid state, account binding and exact denomination.
// A stale worker cannot consume a code; any failure rolls back all four writes.
func CompleteVerifiedCatFKOrder(id int, version int64, redemptionKey string, callerIP string) (alreadyDone bool, err error) {
	order := &CatFKOrder{}
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(order, "id = ?", id).Error; err != nil {
			return err
		}
		if order.Status == CatFKOrderStatusCompleted {
			alreadyDone = true
			return nil
		}
		if order.Status != CatFKOrderStatusPaid || order.Version != version || order.UpstreamOrderID == nil || *order.UpstreamOrderID == "" || order.ExpectedQuota <= 0 {
			return ErrCatFKOrderConflict
		}
		topup := &TopUp{}
		if err := lockForUpdate(tx).First(topup, "id = ?", order.TopUpID).Error; err != nil {
			return err
		}
		if topup.UserId != order.UserID || topup.TradeNo != order.TradeNo || topup.PaymentProvider != PaymentProviderCatFK || topup.PaymentMethod != PaymentMethodCatFK || topup.Status != common.TopUpStatusPending {
			return ErrCatFKOrderConflict
		}
		now := common.GetTimestamp()
		result := tx.Model(&CatFKOrder{}).Where("id = ? AND version = ? AND status = ?", id, version, CatFKOrderStatusPaid).Updates(map[string]any{"status": CatFKOrderStatusCompleted, "version": gorm.Expr("version + 1"), "updated_at": now, "lease_until": 0, "next_query_at": 0, "credential_ciphertext": "", "failure_code": ""})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCatFKOrderConflict
		}
		redemption, err := redeemInTransaction(tx, redemptionKey, order.UserID, order.ExpectedQuota)
		if err != nil {
			return err
		}
		if err := tx.Model(&CatFKOrder{}).Where("id = ?", id).Update("redemption_id", redemption.Id).Error; err != nil {
			return err
		}
		invoiceAmount, err := InvoiceAmountFromQuota(order.ExpectedQuota)
		if err != nil {
			return err
		}
		result = tx.Model(&TopUp{}).Where("id = ? AND status = ?", topup.Id, common.TopUpStatusPending).Updates(map[string]any{"status": common.TopUpStatusSuccess, "complete_time": now, "credited_quota": int64(order.ExpectedQuota), "invoice_amount": invoiceAmount})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCatFKOrderConflict
		}
		return nil
	})
	if err != nil || alreadyDone {
		return alreadyDone, err
	}
	syncCreditUserQuotaCache(order.UserID, order.ExpectedQuota, "catfk topup")
	RecordTopupLog(order.UserID, common.NewMessage("Online top-up succeeded, amount added: {{quota}}, payment amount: {{amount}}", map[string]any{"quota": logger.FormatQuota(order.ExpectedQuota), "amount": order.PriceAmount + " " + order.Currency}), callerIP, PaymentMethodCatFK, PaymentProviderCatFK)
	return false, nil
}
