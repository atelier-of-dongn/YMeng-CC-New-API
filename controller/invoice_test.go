package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
