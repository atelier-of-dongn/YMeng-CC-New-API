package model

import (
	"errors"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func insertInvoiceTestUser(t *testing.T, id, quota int) {
	t.Helper()
	require.NoError(t, DB.Create(&User{
		Id:       id,
		Username: "invoice-user",
		Status:   common.UserStatusEnabled,
		Quota:    quota,
	}).Error)
}

func insertInvoiceTestTopUp(t *testing.T, userId int, tradeNo, provider, status string, amount int64) *TopUp {
	t.Helper()
	topUp := &TopUp{
		UserId:          userId,
		Amount:          amount,
		Money:           float64(amount),
		TradeNo:         tradeNo,
		PaymentMethod:   provider,
		PaymentProvider: provider,
		CreateTime:      100,
		CompleteTime:    200,
		Status:          status,
	}
	require.NoError(t, DB.Create(topUp).Error)
	return topUp
}

func TestGetInvoiceEligibilityExcludesNonPaymentSources(t *testing.T) {
	truncateTables(t)
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 100
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })
	insertInvoiceTestUser(t, 1001, 0)
	eligible := insertInvoiceTestTopUp(t, 1001, "paid", PaymentProviderEpay, common.TopUpStatusSuccess, 600)
	insertInvoiceTestTopUp(t, 1001, "subscription", "", common.TopUpStatusSuccess, 600)
	insertInvoiceTestTopUp(t, 1001, "affiliate", "affiliate", common.TopUpStatusSuccess, 600)
	insertInvoiceTestTopUp(t, 1001, "balance", PaymentProviderBalance, common.TopUpStatusSuccess, 600)
	insertInvoiceTestTopUp(t, 1001, "pending", PaymentProviderEpay, common.TopUpStatusPending, 600)

	result, err := GetInvoiceEligibility(1001)
	require.NoError(t, err)
	require.Len(t, result.Orders, 1)
	assert.Equal(t, eligible.Id, result.Orders[0].Id)
	assert.Equal(t, int64(600*InvoiceAmountScale), result.Orders[0].Amount)
}

func TestCreateInvoiceApplicationRequiresNetAmountGreaterThan500(t *testing.T) {
	truncateTables(t)
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 100
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })
	insertInvoiceTestUser(t, 1002, 10_000)
	order := insertInvoiceTestTopUp(t, 1002, "exact-minimum", PaymentProviderEpay, common.TopUpStatusSuccess, 500)

	_, err := CreateInvoiceApplication(1002, "Example Company", "91350000TEST", []int{order.Id})
	require.ErrorIs(t, err, ErrInvoiceAmountTooLow)

	order.Amount = 501
	order.Money = 501
	order.CreditedQuota = 0
	order.InvoiceAmount = 0
	require.NoError(t, DB.Save(order).Error)
	application, err := CreateInvoiceApplication(1002, "Example Company", "91350000TEST", []int{order.Id})
	require.NoError(t, err)
	assert.Equal(t, InvoiceStatusApplied, application.Status)
	assert.Equal(t, int64(501*InvoiceAmountScale), application.NetAmount)
}

func TestPendingRefundsAreForcedAndConsumedOnce(t *testing.T) {
	truncateTables(t)
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 100
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })
	insertInvoiceTestUser(t, 1003, 100_000)
	first := insertInvoiceTestTopUp(t, 1003, "first", PaymentProviderEpay, common.TopUpStatusSuccess, 600)
	require.NoError(t, ApplyAdminQuotaDeduction(1003, 9001, 10_000, "subtract"))

	_, err := CreateInvoiceApplication(1003, "Example Company", "91350000TEST", []int{first.Id})
	require.ErrorIs(t, err, ErrInvoiceAmountTooLow)

	second := insertInvoiceTestTopUp(t, 1003, "second", PaymentProviderEpay, common.TopUpStatusSuccess, 1)
	application, err := CreateInvoiceApplication(1003, "Example Company", "91350000TEST", []int{first.Id, second.Id})
	require.NoError(t, err)
	assert.Equal(t, int64(100*InvoiceAmountScale), application.RefundAmount)
	assert.Equal(t, int64(501*InvoiceAmountScale), application.NetAmount)

	var pending int64
	require.NoError(t, DB.Model(&InvoiceRefundAdjustment{}).Where("user_id = ? AND application_id IS NULL", 1003).Count(&pending).Error)
	assert.Zero(t, pending)

	var invoiceItems []InvoiceApplicationItem
	require.NoError(t, DB.Where("application_id = ?", application.Id).Find(&invoiceItems).Error)
	require.Len(t, invoiceItems, 3)
	var refundItems []InvoiceApplicationItem
	for _, item := range invoiceItems {
		if item.Type == InvoiceItemTypeRefund {
			refundItems = append(refundItems, item)
		}
	}
	require.Len(t, refundItems, 1)
	assert.Equal(t, -100*InvoiceAmountScale, refundItems[0].Amount)

	require.NoError(t, ApplyAdminQuotaDeduction(1003, 9001, 100, "subtract"))
	third := insertInvoiceTestTopUp(t, 1003, "third", PaymentProviderEpay, common.TopUpStatusSuccess, 502)
	next, err := CreateInvoiceApplication(1003, "Example Company", "91350000TEST", []int{third.Id})
	require.NoError(t, err)
	assert.Equal(t, int64(InvoiceAmountScale), next.RefundAmount)
	assert.Equal(t, int64(501*InvoiceAmountScale), next.NetAmount)
}

func TestInvoiceOrderCannotBeUsedTwice(t *testing.T) {
	truncateTables(t)
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 100
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })
	insertInvoiceTestUser(t, 1004, 0)
	order := insertInvoiceTestTopUp(t, 1004, "single-use", PaymentProviderWaffo, common.TopUpStatusSuccess, 501)

	_, err := CreateInvoiceApplication(1004, "Example Company", "91350000TEST", []int{order.Id})
	require.NoError(t, err)
	_, err = CreateInvoiceApplication(1004, "Example Company", "91350000TEST", []int{order.Id})
	require.True(t, errors.Is(err, ErrInvoiceOrderInvalid))
}

func TestInvoiceStatusTransitionsAreMonotonic(t *testing.T) {
	truncateTables(t)
	application := &InvoiceApplication{
		UserId:      1005,
		Title:       "Example Company",
		TaxId:       "91350000TEST",
		GrossAmount: 501 * InvoiceAmountScale,
		NetAmount:   501 * InvoiceAmountScale,
		Status:      InvoiceStatusApplied,
		CreatedAt:   100,
		UpdatedAt:   100,
	}
	require.NoError(t, DB.Create(application).Error)

	require.ErrorIs(t, MarkInvoiceIssued(application.Id, "invoice.pdf", "invoice.pdf", 10, "hash"), ErrInvoiceStatusInvalid)
	require.NoError(t, MarkInvoiceProcessing(application.Id))
	require.ErrorIs(t, MarkInvoiceProcessing(application.Id), ErrInvoiceStatusInvalid)
	require.NoError(t, MarkInvoiceIssued(application.Id, "invoice.pdf", "invoice.pdf", 10, "hash"))
	require.ErrorIs(t, MarkInvoiceProcessing(application.Id), ErrInvoiceStatusInvalid)
	require.ErrorIs(t, RejectInvoiceApplication(application.Id, "already issued"), ErrInvoiceStatusInvalid)
}

func TestRejectInvoiceApplicationValidatesReasonAndStatus(t *testing.T) {
	truncateTables(t)
	applications := []*InvoiceApplication{
		{UserId: 1007, Title: "Applied", TaxId: "TAX-A", GrossAmount: 501 * InvoiceAmountScale, NetAmount: 501 * InvoiceAmountScale, Status: InvoiceStatusApplied, CreatedAt: 100, UpdatedAt: 100},
		{UserId: 1007, Title: "Processing", TaxId: "TAX-B", GrossAmount: 501 * InvoiceAmountScale, NetAmount: 501 * InvoiceAmountScale, Status: InvoiceStatusProcessing, CreatedAt: 100, UpdatedAt: 100},
	}
	require.NoError(t, DB.Create(&applications).Error)

	require.ErrorIs(t, RejectInvoiceApplication(applications[0].Id, "   "), ErrInvoiceRejectReasonInvalid)
	require.ErrorIs(t, RejectInvoiceApplication(applications[0].Id, strings.Repeat("理", InvoiceMaxRejectReasonLength+1)), ErrInvoiceRejectReasonInvalid)

	require.NoError(t, RejectInvoiceApplication(applications[0].Id, "  Missing tax information  "))
	require.NoError(t, RejectInvoiceApplication(applications[1].Id, "Unsupported invoice title"))
	for index, application := range applications {
		var stored InvoiceApplication
		require.NoError(t, DB.First(&stored, application.Id).Error)
		assert.Equal(t, InvoiceStatusRejected, stored.Status)
		assert.NotZero(t, stored.RejectedAt)
		if index == 0 {
			assert.Equal(t, "Missing tax information", stored.RejectReason)
		}
		require.ErrorIs(t, RejectInvoiceApplication(application.Id, "reject again"), ErrInvoiceStatusInvalid)
	}
}

func TestRejectedInvoiceReleasesOrdersAndRefundsForReapplication(t *testing.T) {
	truncateTables(t)
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 100
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })
	insertInvoiceTestUser(t, 1008, 100_000)
	order := insertInvoiceTestTopUp(t, 1008, "reusable", PaymentProviderEpay, common.TopUpStatusSuccess, 700)
	require.NoError(t, ApplyAdminQuotaDeduction(1008, 9001, 10_000, "subtract"))

	first, err := CreateInvoiceApplication(1008, "Example Company", "91350000TEST", []int{order.Id})
	require.NoError(t, err)
	require.NoError(t, RejectInvoiceApplication(first.Id, "Please correct the invoice title"))

	var originalItems []InvoiceApplicationItem
	require.NoError(t, DB.Where("application_id = ?", first.Id).Find(&originalItems).Error)
	require.Len(t, originalItems, 2)

	eligibility, err := GetInvoiceEligibility(1008)
	require.NoError(t, err)
	require.Len(t, eligibility.Orders, 1)
	assert.Empty(t, eligibility.Orders[0].InvoiceStatus)
	require.Len(t, eligibility.PendingRefunds, 1)

	second, err := CreateInvoiceApplication(1008, "Corrected Company", "91350000TEST", []int{order.Id})
	require.NoError(t, err)
	assert.Equal(t, int64(600*InvoiceAmountScale), second.NetAmount)

	var secondItems []InvoiceApplicationItem
	require.NoError(t, DB.Where("application_id = ?", second.Id).Find(&secondItems).Error)
	require.Len(t, secondItems, 2)
}

func TestInvoiceDownloadRequiresOwnerOrAdmin(t *testing.T) {
	truncateTables(t)
	application := &InvoiceApplication{
		UserId:      1005,
		Title:       "Example Company",
		TaxId:       "91350000TEST",
		GrossAmount: 501 * InvoiceAmountScale,
		NetAmount:   501 * InvoiceAmountScale,
		Status:      InvoiceStatusIssued,
		FileKey:     "invoice.pdf",
		CreatedAt:   100,
		UpdatedAt:   100,
		IssuedAt:    100,
	}
	require.NoError(t, DB.Create(application).Error)

	_, err := GetInvoiceApplicationForDownload(application.Id, 1005, common.RoleCommonUser)
	require.NoError(t, err)
	_, err = GetInvoiceApplicationForDownload(application.Id, 1006, common.RoleCommonUser)
	require.ErrorIs(t, err, ErrInvoiceNotFound)
	_, err = GetInvoiceApplicationForDownload(application.Id, 1006, common.RoleAdminUser)
	require.NoError(t, err)
}

func TestQuotaOverrideCreatesRefundOnlyWhenDecreasing(t *testing.T) {
	truncateTables(t)
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 100
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })
	insertInvoiceTestUser(t, 1006, 10_000)

	require.NoError(t, ApplyAdminQuotaOverride(1006, 9001, 10_000, 12_000))
	var count int64
	require.NoError(t, DB.Model(&InvoiceRefundAdjustment{}).Where("user_id = ?", 1006).Count(&count).Error)
	assert.Zero(t, count)

	require.NoError(t, ApplyAdminQuotaOverride(1006, 9001, 12_000, 7_000))
	var adjustment InvoiceRefundAdjustment
	require.NoError(t, DB.Where("user_id = ?", 1006).First(&adjustment).Error)
	assert.Equal(t, int64(5_000), adjustment.Quota)
	assert.Equal(t, int64(50*InvoiceAmountScale), adjustment.Amount)
}
