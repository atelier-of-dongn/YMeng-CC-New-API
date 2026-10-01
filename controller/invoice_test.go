package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupInvoiceControllerTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gin.SetMode(gin.TestMode)
	previousDB := model.DB
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	require.NoError(t, db.AutoMigrate(&model.InvoiceApplication{}, &model.InvoiceRefundAdjustment{}))
	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func TestRejectInvoiceApplicationAPIRequiresAndPersistsReason(t *testing.T) {
	db := setupInvoiceControllerTestDB(t)
	application := &model.InvoiceApplication{
		UserId:      42,
		Title:       "Example Company",
		TaxId:       "91350000TEST",
		GrossAmount: 501 * model.InvoiceAmountScale,
		NetAmount:   501 * model.InvoiceAmountScale,
		Status:      model.InvoiceStatusApplied,
		CreatedAt:   100,
		UpdatedAt:   100,
	}
	require.NoError(t, db.Create(application).Error)

	invalidRecorder := httptest.NewRecorder()
	invalidContext, _ := gin.CreateTestContext(invalidRecorder)
	invalidContext.Params = gin.Params{{Key: "id", Value: fmt.Sprint(application.Id)}}
	invalidContext.Request = httptest.NewRequest(http.MethodPatch, "/api/invoice/admin/1/reject", strings.NewReader(`{"reason":"   "}`))
	RejectInvoiceApplication(invalidContext)
	assert.Contains(t, invalidRecorder.Body.String(), `"success":false`)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Params = gin.Params{{Key: "id", Value: fmt.Sprint(application.Id)}}
	ctx.Request = httptest.NewRequest(http.MethodPatch, "/api/invoice/admin/1/reject", strings.NewReader(`{"reason":"  Incorrect tax identifier  "}`))
	RejectInvoiceApplication(ctx)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var stored model.InvoiceApplication
	require.NoError(t, db.First(&stored, application.Id).Error)
	assert.Equal(t, model.InvoiceStatusRejected, stored.Status)
	assert.Equal(t, "Incorrect tax identifier", stored.RejectReason)
}

func TestGetAllInvoiceApplicationsAPIRejectsInvalidFilters(t *testing.T) {
	setupInvoiceControllerTestDB(t)
	for _, query := range []string{
		"status=unknown",
		"user_id=0",
		"net_amount_min=1.1234567",
		"net_amount_min=-1",
		"gross_amount_min=9&gross_amount_max=8",
		"created_at_from=20&created_at_to=10",
		"p=-1",
		"page_size=101",
		"title=" + strings.Repeat("a", 256),
	} {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/invoice/admin/?"+query, nil)
		GetAllInvoiceApplications(ctx)
		assert.Contains(t, recorder.Body.String(), `"success":false`, query)
	}
}

func TestDownloadInvoicePDFAPIServesPrivatePDF(t *testing.T) {
	db := setupInvoiceControllerTestDB(t)
	dir := t.TempDir()
	t.Setenv("INVOICE_STORAGE_DIR", dir)
	content := []byte("%PDF-1.7\n%%EOF")
	require.NoError(t, os.WriteFile(filepath.Join(dir, "invoice-1-key.pdf"), content, 0600))
	application := &model.InvoiceApplication{
		UserId:      42,
		Title:       "Example Company",
		TaxId:       "91350000TEST",
		GrossAmount: 501 * model.InvoiceAmountScale,
		NetAmount:   501 * model.InvoiceAmountScale,
		Status:      model.InvoiceStatusIssued,
		FileKey:     "invoice-1-key.pdf",
		FileName:    "发票.pdf",
		CreatedAt:   100,
		UpdatedAt:   100,
		IssuedAt:    100,
	}
	require.NoError(t, db.Create(application).Error)

	download := func(userId, role int) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Params = gin.Params{{Key: "id", Value: fmt.Sprint(application.Id)}}
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/invoice/admin/1/file", nil)
		ctx.Set("id", userId)
		ctx.Set("role", role)
		DownloadInvoicePDF(ctx)
		return recorder
	}

	recorder := download(1, common.RoleAdminUser)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, content, recorder.Body.Bytes())
	assert.Equal(t, "application/pdf", recorder.Header().Get("Content-Type"))
	assert.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
	assert.Equal(t, "nosniff", recorder.Header().Get("X-Content-Type-Options"))
	assert.Contains(t, recorder.Header().Get("Content-Disposition"), "attachment")

	denied := download(7, common.RoleCommonUser)
	assert.Contains(t, denied.Body.String(), `"success":false`)

	require.NoError(t, os.Remove(filepath.Join(dir, "invoice-1-key.pdf")))
	missing := download(1, common.RoleAdminUser)
	assert.Contains(t, missing.Body.String(), `"success":false`)
	assert.NotContains(t, missing.Body.String(), dir)
}
