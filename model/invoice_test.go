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

func TestAdminInvoiceFiltersApplyBeforePagination(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&[]User{
		{Id: 2001, Username: "alice_%", AffCode: "invoice-filter-a", Status: common.UserStatusEnabled},
		{Id: 2002, Username: "bob", AffCode: "invoice-filter-b", Status: common.UserStatusEnabled},
	}).Error)
	applications := []*InvoiceApplication{
		{UserId: 2001, Title: "Acme 100%", TaxId: "TAX-A", GrossAmount: 600 * InvoiceAmountScale, NetAmount: 600 * InvoiceAmountScale, Status: InvoiceStatusApplied, CreatedAt: 1000, UpdatedAt: 1000},
		{UserId: 2002, Title: "Beta", TaxId: "TAX-B", GrossAmount: 700 * InvoiceAmountScale, NetAmount: 700 * InvoiceAmountScale, Status: InvoiceStatusIssued, CreatedAt: 2000, UpdatedAt: 2000},
		{UserId: 2002, Title: "acme lab", TaxId: "TAX-C", GrossAmount: 800 * InvoiceAmountScale, NetAmount: 800 * InvoiceAmountScale, Status: InvoiceStatusIssued, CreatedAt: 3000, UpdatedAt: 3000},
	}
	require.NoError(t, DB.Create(&applications).Error)
	require.NoError(t, DB.Create(&[]InvoiceApplicationItem{
		{ApplicationId: applications[0].Id, Type: InvoiceItemTypeOrder, TradeNo: "T-1", Amount: 300 * InvoiceAmountScale, OccurredAt: 900},
		{ApplicationId: applications[0].Id, Type: InvoiceItemTypeOrder, TradeNo: "T-10", Amount: 300 * InvoiceAmountScale, OccurredAt: 900},
		{ApplicationId: applications[1].Id, Type: InvoiceItemTypeOrder, TradeNo: "X-T-1", Amount: 700 * InvoiceAmountScale, OccurredAt: 1900},
		{ApplicationId: applications[2].Id, Type: InvoiceItemTypeOrder, TradeNo: "Z-9", Amount: 800 * InvoiceAmountScale, OccurredAt: 2900},
	}).Error)
	amount700 := int64(700 * InvoiceAmountScale)
	createdFrom, createdTo := int64(2000), int64(3000)

	tests := []struct {
		name    string
		filters InvoiceApplicationFilters
		wantIds []int
	}{
		{"order number matches one application once", InvoiceApplicationFilters{TradeNo: "t-1"}, []int{applications[1].Id, applications[0].Id}},
		{"title search is case-insensitive", InvoiceApplicationFilters{Title: "ACME"}, []int{applications[2].Id, applications[0].Id}},
		{"wildcards are matched literally", InvoiceApplicationFilters{Title: "100%"}, []int{applications[0].Id}},
		{"username wildcards are matched literally", InvoiceApplicationFilters{Username: "_%"}, []int{applications[0].Id}},
		{"amount range is inclusive", InvoiceApplicationFilters{NetAmountMin: &amount700, NetAmountMax: &amount700}, []int{applications[1].Id}},
		{"applied time upper bound is exclusive", InvoiceApplicationFilters{CreatedAtFrom: &createdFrom, CreatedAtTo: &createdTo}, []int{applications[1].Id}},
		{"filters combine with status", InvoiceApplicationFilters{Status: InvoiceStatusIssued, Title: "acme"}, []int{applications[2].Id}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, total, err := GetAllInvoiceApplications(tt.filters, &common.PageInfo{Page: 1, PageSize: 10})
			require.NoError(t, err)
			assert.Equal(t, int64(len(tt.wantIds)), total)
			ids := make([]int, 0, len(result))
			for _, application := range result {
				ids = append(ids, application.Id)
			}
			assert.Equal(t, tt.wantIds, ids)
		})
	}

	result, total, err := GetAllInvoiceApplications(InvoiceApplicationFilters{TradeNo: "T-1"}, &common.PageInfo{Page: 2, PageSize: 1})
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, result, 1)
	assert.Equal(t, applications[0].Id, result[0].Id)
	assert.Equal(t, "alice_%", result[0].Username)
	assert.Len(t, result[0].Items, 2, "matching one order must still load every order of the application")
}
