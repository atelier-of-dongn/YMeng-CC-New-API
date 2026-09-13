package model

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	InvoiceStatusApplied    = "applied"
	InvoiceStatusProcessing = "processing"
	InvoiceStatusIssued     = "issued"
	InvoiceStatusRejected   = "rejected"

	InvoiceItemTypeOrder  = "order"
	InvoiceItemTypeRefund = "refund"

	InvoiceAmountScale           int64 = 1_000_000
	InvoiceMinimumAmount         int64 = 500 * InvoiceAmountScale
	InvoiceMaxTitleLength              = 200
	InvoiceMaxTaxIdLength              = 64
	InvoiceMaxRejectReasonLength       = 500
)

var (
	ErrInvoiceAmountTooLow        = errors.New("invoice amount must be greater than 500")
	ErrInvoiceOrderInvalid        = errors.New("invoice order is invalid or already in an invoice process")
	ErrInvoiceStatusInvalid       = errors.New("invoice status transition is invalid")
	ErrInvoiceRejectReasonInvalid = errors.New("invoice rejection reason is required and must be 500 characters or fewer")
	ErrInvoiceNotFound            = errors.New("invoice application not found")
	ErrInvoiceProfileInvalid      = errors.New("invoice title and tax identifier are required")
	invoiceEligiblePaymentMethod  = []string{
		PaymentProviderEpay,
		PaymentProviderStripe,
		PaymentProviderCreem,
		PaymentProviderWaffo,
		PaymentProviderWaffoPancake,
		PaymentProviderRedemption,
	}
)

func migrateInvoiceApplicationItemIndexes() error {
	legacyIndexes := []string{
		"idx_invoice_application_items_top_up_id",
		"idx_invoice_application_items_refund_adjustment_id",
	}
	for _, index := range legacyIndexes {
		if !DB.Migrator().HasIndex(&InvoiceApplicationItem{}, index) {
			continue
		}
		if err := DB.Migrator().DropIndex(&InvoiceApplicationItem{}, index); err != nil {
			return fmt.Errorf("drop legacy invoice item index %s: %w", index, err)
		}
	}
	return nil
}

type InvoiceProfile struct {
	Id        int    `json:"id"`
	UserId    int    `json:"user_id" gorm:"uniqueIndex;not null"`
	Title     string `json:"title" gorm:"type:varchar(200);not null"`
	TaxId     string `json:"tax_id" gorm:"type:varchar(64);not null"`
	CreatedAt int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt int64  `json:"updated_at" gorm:"type:bigint;not null"`
}

type InvoiceApplication struct {
	Id           int                       `json:"id"`
	UserId       int                       `json:"user_id" gorm:"index;not null"`
	Title        string                    `json:"title" gorm:"type:varchar(200);not null"`
	TaxId        string                    `json:"tax_id" gorm:"type:varchar(64);not null"`
	GrossAmount  int64                     `json:"gross_amount" gorm:"type:bigint;not null"`
	RefundAmount int64                     `json:"refund_amount" gorm:"type:bigint;not null"`
	NetAmount    int64                     `json:"net_amount" gorm:"type:bigint;not null"`
	Status       string                    `json:"status" gorm:"type:varchar(32);index;not null"`
	CreatedAt    int64                     `json:"created_at" gorm:"type:bigint;index;not null"`
	UpdatedAt    int64                     `json:"updated_at" gorm:"type:bigint;not null"`
	IssuedAt     int64                     `json:"issued_at" gorm:"type:bigint;not null"`
	RejectedAt   int64                     `json:"rejected_at" gorm:"type:bigint"`
	RejectReason string                    `json:"reject_reason,omitempty" gorm:"type:text"`
	FileKey      string                    `json:"-" gorm:"type:varchar(255);not null"`
	FileName     string                    `json:"file_name,omitempty" gorm:"type:varchar(255);not null"`
	FileSize     int64                     `json:"file_size,omitempty" gorm:"type:bigint;not null"`
	FileSha256   string                    `json:"-" gorm:"type:varchar(64);not null"`
	Username     string                    `json:"username,omitempty" gorm:"-"`
	Items        []*InvoiceApplicationItem `json:"items,omitempty" gorm:"foreignKey:ApplicationId"`
}

type InvoiceApplicationItem struct {
	Id                 int    `json:"id"`
	ApplicationId      int    `json:"application_id" gorm:"index;not null"`
	Type               string `json:"type" gorm:"type:varchar(16);not null"`
	TopUpId            *int   `json:"top_up_id,omitempty" gorm:"index:idx_invoice_items_top_up_id"`
	RefundAdjustmentId *int   `json:"refund_adjustment_id,omitempty" gorm:"index:idx_invoice_items_refund_adjustment_id"`
	TradeNo            string `json:"trade_no,omitempty" gorm:"type:varchar(255);not null"`
	Amount             int64  `json:"amount" gorm:"type:bigint;not null"`
	OccurredAt         int64  `json:"occurred_at" gorm:"type:bigint;not null"`
}

type InvoiceRefundAdjustment struct {
	Id            int    `json:"id"`
	UserId        int    `json:"user_id" gorm:"index;not null"`
	AdminUserId   int    `json:"admin_user_id" gorm:"index;not null"`
	ApplicationId *int   `json:"application_id,omitempty" gorm:"index"`
	Quota         int64  `json:"quota" gorm:"type:bigint;not null"`
	Amount        int64  `json:"amount" gorm:"type:bigint;not null"`
	Source        string `json:"source" gorm:"type:varchar(32);not null"`
	CreatedAt     int64  `json:"created_at" gorm:"type:bigint;index;not null"`
}

type InvoiceOrderItem struct {
	Id              int    `json:"id"`
	TradeNo         string `json:"trade_no"`
	PaymentProvider string `json:"payment_provider"`
	Amount          int64  `json:"amount"`
	CreatedAt       int64  `json:"created_at"`
	CompletedAt     int64  `json:"completed_at"`
	InvoiceStatus   string `json:"invoice_status,omitempty"`
}

type InvoiceEligibility struct {
	Profile        *InvoiceProfile            `json:"profile"`
	Orders         []*InvoiceOrderItem        `json:"orders"`
	PendingRefunds []*InvoiceRefundAdjustment `json:"pending_refunds"`
	MinimumAmount  int64                      `json:"minimum_amount"`
}

func IsInvoiceEligiblePaymentProvider(provider string) bool {
	for _, eligible := range invoiceEligiblePaymentMethod {
		if provider == eligible {
			return true
		}
	}
	return false
}

func CalculateTopUpInvoiceSnapshot(topUp *TopUp) (int64, int64, error) {
	if topUp == nil || !IsInvoiceEligiblePaymentProvider(topUp.PaymentProvider) {
		return 0, 0, ErrInvoiceOrderInvalid
	}
	if topUp.CreditedQuota > 0 && topUp.InvoiceAmount > 0 {
		return topUp.CreditedQuota, topUp.InvoiceAmount, nil
	}
	quotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
	if quotaPerUnit.LessThanOrEqual(decimal.Zero) {
		return 0, 0, errors.New("quota per unit must be positive")
	}

	var credited decimal.Decimal
	switch topUp.PaymentProvider {
	case PaymentProviderStripe:
		credited = decimal.NewFromFloat(topUp.Money).Mul(quotaPerUnit)
	case PaymentProviderCreem:
		credited = decimal.NewFromInt(topUp.Amount)
	case PaymentProviderRedemption:
		credited = decimal.NewFromInt(topUp.Amount)
	default:
		credited = decimal.NewFromInt(topUp.Amount).Mul(quotaPerUnit)
	}
	creditedQuota := common.QuotaFromDecimal(credited)
	if creditedQuota <= 0 {
		return 0, 0, ErrInvoiceOrderInvalid
	}
	amount := decimal.NewFromInt(int64(creditedQuota)).
		Div(quotaPerUnit).
		Mul(decimal.NewFromInt(InvoiceAmountScale)).
		Round(0).
		IntPart()
	if amount <= 0 {
		return 0, 0, ErrInvoiceOrderInvalid
	}
	return int64(creditedQuota), amount, nil
}

func InvoiceAmountFromQuota(quota int) (int64, error) {
	if quota <= 0 || common.QuotaPerUnit <= 0 {
		return 0, ErrInvoiceOrderInvalid
	}
	amount := decimal.NewFromInt(int64(quota)).
		Div(decimal.NewFromFloat(common.QuotaPerUnit)).
		Mul(decimal.NewFromInt(InvoiceAmountScale)).
		Round(0).
		IntPart()
	if amount <= 0 {
		return 0, ErrInvoiceOrderInvalid
	}
	return amount, nil
}

func BackfillTopUpInvoiceSnapshots() error {
	var topUps []*TopUp
	return DB.Where("status = ? AND payment_provider IN ? AND invoice_amount = 0", common.TopUpStatusSuccess, invoiceEligiblePaymentMethod).
		FindInBatches(&topUps, 500, func(tx *gorm.DB, _ int) error {
			for _, topUp := range topUps {
				credited, amount, err := CalculateTopUpInvoiceSnapshot(topUp)
				if err != nil {
					continue
				}
				if err := tx.Model(&TopUp{}).Where("id = ?", topUp.Id).Updates(map[string]interface{}{
					"credited_quota": credited,
					"invoice_amount": amount,
				}).Error; err != nil {
					return err
				}
			}
			return nil
		}).Error
}

func BackfillRedemptionInvoiceTopUps() error {
	var redemptions []*Redemption
	return DB.Unscoped().Where("status = ? AND used_user_id > 0 AND quota > 0", common.RedemptionCodeStatusUsed).
		FindInBatches(&redemptions, 500, func(tx *gorm.DB, _ int) error {
			tradeNos := make([]string, 0, len(redemptions))
			for _, redemption := range redemptions {
				tradeNos = append(tradeNos, fmt.Sprintf("redemption:%d", redemption.Id))
			}
			var existingTradeNos []string
			if err := tx.Model(&TopUp{}).Where("trade_no IN ?", tradeNos).Pluck("trade_no", &existingTradeNos).Error; err != nil {
				return err
			}
			existing := make(map[string]struct{}, len(existingTradeNos))
			for _, tradeNo := range existingTradeNos {
				existing[tradeNo] = struct{}{}
			}
			topUps := make([]*TopUp, 0, len(redemptions)-len(existing))
			for _, redemption := range redemptions {
				tradeNo := fmt.Sprintf("redemption:%d", redemption.Id)
				if _, ok := existing[tradeNo]; ok {
					continue
				}
				invoiceAmount, err := InvoiceAmountFromQuota(redemption.Quota)
				if err != nil {
					continue
				}
				completedAt := redemption.RedeemedTime
				if completedAt <= 0 {
					completedAt = redemption.CreatedTime
				}
				topUps = append(topUps, &TopUp{
					UserId:          redemption.UsedUserId,
					Amount:          int64(redemption.Quota),
					TradeNo:         tradeNo,
					PaymentMethod:   PaymentProviderRedemption,
					PaymentProvider: PaymentProviderRedemption,
					CreateTime:      redemption.CreatedTime,
					CompleteTime:    completedAt,
					Status:          common.TopUpStatusSuccess,
					CreditedQuota:   int64(redemption.Quota),
					InvoiceAmount:   invoiceAmount,
				})
			}
			if len(topUps) == 0 {
				return nil
			}
			return tx.Create(&topUps).Error
		}).Error
}

func ApplyAdminQuotaDeduction(userId, adminUserId, quota int, source string) error {
	if quota <= 0 {
		return errors.New("quota deduction must be positive")
	}
	amount, err := InvoiceAmountFromQuota(quota)
	if err != nil {
		return err
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota - ?", quota)).Error; err != nil {
			return err
		}
		return tx.Create(&InvoiceRefundAdjustment{
			UserId:      userId,
			AdminUserId: adminUserId,
			Quota:       int64(quota),
			Amount:      amount,
			Source:      source,
			CreatedAt:   common.GetTimestamp(),
		}).Error
	})
	if err != nil {
		return err
	}
	if err := cacheDecrUserQuota(userId, int64(quota)); err != nil {
		common.SysLog("failed to decrease user quota cache: " + err.Error())
	}
	return nil
}

func ApplyAdminQuotaOverride(userId, adminUserId, oldQuota, newQuota int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", newQuota).Error; err != nil {
			return err
		}
		if newQuota >= oldQuota {
			return nil
		}
		amount, err := InvoiceAmountFromQuota(oldQuota - newQuota)
		if err != nil {
			return err
		}
		return tx.Create(&InvoiceRefundAdjustment{
			UserId:      userId,
			AdminUserId: adminUserId,
			Quota:       int64(oldQuota - newQuota),
			Amount:      amount,
			Source:      "override",
			CreatedAt:   common.GetTimestamp(),
		}).Error
	})
}

func GetInvoiceEligibility(userId int) (*InvoiceEligibility, error) {
	var profile InvoiceProfile
	profileResult := DB.Where("user_id = ?", userId).First(&profile)
	if profileResult.Error != nil && !errors.Is(profileResult.Error, gorm.ErrRecordNotFound) {
		return nil, profileResult.Error
	}

	var topUps []*TopUp
	if err := DB.Where("user_id = ? AND status = ? AND payment_provider IN ?", userId, common.TopUpStatusSuccess, invoiceEligiblePaymentMethod).
		Order("complete_time DESC, id DESC").Find(&topUps).Error; err != nil {
		return nil, err
	}

	statusByTopUp := map[int]string{}
	if len(topUps) > 0 {
		ids := make([]int, 0, len(topUps))
		for _, topUp := range topUps {
			ids = append(ids, topUp.Id)
		}
		var rows []struct {
			TopUpId int
			Status  string
		}
		if err := DB.Table("invoice_application_items AS item").
			Select("item.top_up_id, application.status").
			Joins("JOIN invoice_applications AS application ON application.id = item.application_id").
			Where("item.top_up_id IN ? AND application.status <> ?", ids, InvoiceStatusRejected).Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			statusByTopUp[row.TopUpId] = row.Status
		}
	}

	orders := make([]*InvoiceOrderItem, 0, len(topUps))
	for _, topUp := range topUps {
		amount := topUp.InvoiceAmount
		if amount <= 0 {
			_, calculated, err := CalculateTopUpInvoiceSnapshot(topUp)
			if err != nil {
				continue
			}
			amount = calculated
		}
		orders = append(orders, &InvoiceOrderItem{
			Id:              topUp.Id,
			TradeNo:         topUp.TradeNo,
			PaymentProvider: topUp.PaymentProvider,
			Amount:          amount,
			CreatedAt:       topUp.CreateTime,
			CompletedAt:     topUp.CompleteTime,
			InvoiceStatus:   statusByTopUp[topUp.Id],
		})
	}

	var refunds []*InvoiceRefundAdjustment
	if err := DB.Where("user_id = ? AND application_id IS NULL", userId).Order("id ASC").Find(&refunds).Error; err != nil {
		return nil, err
	}
	eligibility := &InvoiceEligibility{
		Orders:         orders,
		PendingRefunds: refunds,
		MinimumAmount:  InvoiceMinimumAmount,
	}
	if profileResult.Error == nil {
		eligibility.Profile = &profile
	}
	return eligibility, nil
}

func CreateInvoiceApplication(userId int, title, taxId string, topUpIds []int) (*InvoiceApplication, error) {
	title = strings.TrimSpace(title)
	taxId = strings.TrimSpace(taxId)
	if title == "" || taxId == "" || len([]rune(title)) > InvoiceMaxTitleLength || len([]rune(taxId)) > InvoiceMaxTaxIdLength {
		return nil, ErrInvoiceProfileInvalid
	}
	if len(topUpIds) == 0 {
		return nil, ErrInvoiceOrderInvalid
	}
	sort.Ints(topUpIds)
	uniqueIds := topUpIds[:0]
	for _, id := range topUpIds {
		if id <= 0 || len(uniqueIds) > 0 && uniqueIds[len(uniqueIds)-1] == id {
			continue
		}
		uniqueIds = append(uniqueIds, id)
	}
	if len(uniqueIds) == 0 {
		return nil, ErrInvoiceOrderInvalid
	}

	application := &InvoiceApplication{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var topUps []*TopUp
		if err := lockForUpdate(tx).Where("id IN ? AND user_id = ?", uniqueIds, userId).Order("id ASC").Find(&topUps).Error; err != nil {
			return err
		}
		if len(topUps) != len(uniqueIds) {
			return ErrInvoiceOrderInvalid
		}
		var existing int64
		if err := tx.Table("invoice_application_items AS item").
			Joins("JOIN invoice_applications AS application ON application.id = item.application_id").
			Where("item.top_up_id IN ? AND application.status <> ?", uniqueIds, InvoiceStatusRejected).
			Count(&existing).Error; err != nil {
			return err
		}
		if existing > 0 {
			return ErrInvoiceOrderInvalid
		}

		grossAmount := int64(0)
		for _, topUp := range topUps {
			if topUp.Status != common.TopUpStatusSuccess || !IsInvoiceEligiblePaymentProvider(topUp.PaymentProvider) {
				return ErrInvoiceOrderInvalid
			}
			credited, amount, err := CalculateTopUpInvoiceSnapshot(topUp)
			if err != nil {
				return err
			}
			topUp.CreditedQuota = credited
			topUp.InvoiceAmount = amount
			if err := tx.Model(&TopUp{}).Where("id = ?", topUp.Id).Updates(map[string]interface{}{
				"credited_quota": credited,
				"invoice_amount": amount,
			}).Error; err != nil {
				return err
			}
			grossAmount += amount
		}

		var refunds []*InvoiceRefundAdjustment
		if err := lockForUpdate(tx).Where("user_id = ? AND application_id IS NULL", userId).Order("id ASC").Find(&refunds).Error; err != nil {
			return err
		}
		refundAmount := int64(0)
		for _, refund := range refunds {
			refundAmount += refund.Amount
		}
		netAmount := grossAmount - refundAmount
		if netAmount <= InvoiceMinimumAmount {
			return ErrInvoiceAmountTooLow
		}

		now := common.GetTimestamp()
		application = &InvoiceApplication{
			UserId:       userId,
			Title:        title,
			TaxId:        taxId,
			GrossAmount:  grossAmount,
			RefundAmount: refundAmount,
			NetAmount:    netAmount,
			Status:       InvoiceStatusApplied,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if err := tx.Create(application).Error; err != nil {
			return err
		}
		items := make([]*InvoiceApplicationItem, 0, len(topUps)+len(refunds))
		for _, topUp := range topUps {
			topUpId := topUp.Id
			items = append(items, &InvoiceApplicationItem{
				ApplicationId: application.Id,
				Type:          InvoiceItemTypeOrder,
				TopUpId:       &topUpId,
				TradeNo:       topUp.TradeNo,
				Amount:        topUp.InvoiceAmount,
				OccurredAt:    topUp.CompleteTime,
			})
		}
		for _, refund := range refunds {
			refundId := refund.Id
			items = append(items, &InvoiceApplicationItem{
				ApplicationId:      application.Id,
				Type:               InvoiceItemTypeRefund,
				RefundAdjustmentId: &refundId,
				Amount:             -refund.Amount,
				OccurredAt:         refund.CreatedAt,
			})
		}
		if err := tx.Create(&items).Error; err != nil {
			return err
		}
		if len(refunds) > 0 {
			refundIds := make([]int, 0, len(refunds))
			for _, refund := range refunds {
				refundIds = append(refundIds, refund.Id)
			}
			if err := tx.Model(&InvoiceRefundAdjustment{}).Where("id IN ? AND application_id IS NULL", refundIds).
				Update("application_id", application.Id).Error; err != nil {
				return err
			}
		}
		var profile InvoiceProfile
		result := tx.Where("user_id = ?", userId).First(&profile)
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return tx.Create(&InvoiceProfile{UserId: userId, Title: title, TaxId: taxId, CreatedAt: now, UpdatedAt: now}).Error
		}
		if result.Error != nil {
			return result.Error
		}
		return tx.Model(&profile).Updates(map[string]interface{}{"title": title, "tax_id": taxId, "updated_at": now}).Error
	})
	if err != nil {
		return nil, err
	}
	return application, nil
}

func listInvoiceApplications(query *gorm.DB, pageInfo *common.PageInfo) ([]*InvoiceApplication, int64, error) {
	var total int64
	if err := query.Model(&InvoiceApplication{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var applications []*InvoiceApplication
	if err := query.Preload("Items").Order("id DESC").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&applications).Error; err != nil {
		return nil, 0, err
	}
	return applications, total, nil
}

func GetUserInvoiceApplications(userId int, pageInfo *common.PageInfo) ([]*InvoiceApplication, int64, error) {
	return listInvoiceApplications(DB.Where("user_id = ?", userId), pageInfo)
}

func GetAllInvoiceApplications(status string, pageInfo *common.PageInfo) ([]*InvoiceApplication, int64, error) {
	query := DB
	if status != "" {
		query = query.Where("status = ?", status)
	}
	applications, total, err := listInvoiceApplications(query, pageInfo)
	if err != nil || len(applications) == 0 {
		return applications, total, err
	}
	userIds := make([]int, 0, len(applications))
	for _, application := range applications {
		userIds = append(userIds, application.UserId)
	}
	var users []User
	if err := DB.Select("id", "username").Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	usernames := map[int]string{}
	for _, user := range users {
		usernames[user.Id] = user.Username
	}
	for _, application := range applications {
		application.Username = usernames[application.UserId]
	}
	return applications, total, nil
}

func MarkInvoiceProcessing(id int) error {
	result := DB.Model(&InvoiceApplication{}).Where("id = ? AND status = ?", id, InvoiceStatusApplied).
		Updates(map[string]interface{}{"status": InvoiceStatusProcessing, "updated_at": common.GetTimestamp()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrInvoiceStatusInvalid
	}
	return nil
}

func MarkInvoiceIssued(id int, fileKey, fileName string, fileSize int64, sha256 string) error {
	now := common.GetTimestamp()
	result := DB.Model(&InvoiceApplication{}).Where("id = ? AND status = ?", id, InvoiceStatusProcessing).
		Updates(map[string]interface{}{
			"status":      InvoiceStatusIssued,
			"updated_at":  now,
			"issued_at":   now,
			"file_key":    fileKey,
			"file_name":   fileName,
			"file_size":   fileSize,
			"file_sha256": sha256,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrInvoiceStatusInvalid
	}
	return nil
}

func RejectInvoiceApplication(id int, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" || len([]rune(reason)) > InvoiceMaxRejectReasonLength {
		return ErrInvoiceRejectReasonInvalid
	}
	now := common.GetTimestamp()
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&InvoiceApplication{}).
			Where("id = ? AND status IN ?", id, []string{InvoiceStatusApplied, InvoiceStatusProcessing}).
			Updates(map[string]interface{}{
				"status":        InvoiceStatusRejected,
				"reject_reason": reason,
				"rejected_at":   now,
				"updated_at":    now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInvoiceStatusInvalid
		}
		return tx.Model(&InvoiceRefundAdjustment{}).
			Where("application_id = ?", id).
			Update("application_id", nil).Error
	})
}

func GetInvoiceApplicationForDownload(id, userId, role int) (*InvoiceApplication, error) {
	var application InvoiceApplication
	query := DB.Where("id = ? AND status = ?", id, InvoiceStatusIssued)
	if role < common.RoleAdminUser {
		query = query.Where("user_id = ?", userId)
	}
	if err := query.First(&application).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvoiceNotFound
		}
		return nil, err
	}
	if application.FileKey == "" {
		return nil, fmt.Errorf("%w: file is missing", ErrInvoiceNotFound)
	}
	return &application, nil
}
