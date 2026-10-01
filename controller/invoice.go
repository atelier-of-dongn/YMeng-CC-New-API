package controller

import (
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

type createInvoiceRequest struct {
	Title    string `json:"title"`
	TaxId    string `json:"tax_id"`
	TopUpIds []int  `json:"top_up_ids"`
}

type rejectInvoiceRequest struct {
	Reason string `json:"reason"`
}

func GetInvoiceEligibility(c *gin.Context) {
	eligibility, err := model.GetInvoiceEligibility(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, eligibility)
}

func CreateInvoiceApplication(c *gin.Context) {
	var request createInvoiceRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorMsg(c, "invalid invoice request")
		return
	}
	application, err := model.CreateInvoiceApplication(c.GetInt("id"), request.Title, request.TaxId, request.TopUpIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, application)
}

func GetUserInvoiceApplications(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	applications, total, err := model.GetUserInvoiceApplications(c.GetInt("id"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(applications)
	common.ApiSuccess(c, pageInfo)
}

const maxInvoiceFilterTextLength = 255

func parseInvoiceFilterAmount(c *gin.Context, key string) (*int64, error) {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return nil, nil
	}
	amount, err := decimal.NewFromString(raw)
	if err != nil || amount.IsNegative() || amount.Exponent() < -6 {
		return nil, strconv.ErrSyntax
	}
	scaled := amount.Mul(decimal.NewFromInt(model.InvoiceAmountScale))
	if !scaled.IsInteger() {
		return nil, strconv.ErrRange
	}
	value, err := strconv.ParseInt(scaled.StringFixed(0), 10, 64)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func parseInvoiceFilterTimestamp(c *gin.Context, key string) (*int64, error) {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return nil, strconv.ErrSyntax
	}
	return &value, nil
}

func parseInvoiceFilterText(c *gin.Context, key string) (string, error) {
	value := strings.TrimSpace(c.Query(key))
	if len([]rune(value)) > maxInvoiceFilterTextLength {
		return "", strconv.ErrRange
	}
	return value, nil
}

func validateInvoicePageQuery(c *gin.Context, pageInfo *common.PageInfo) error {
	for _, key := range []string{"p", "page_size"} {
		raw := strings.TrimSpace(c.Query(key))
		if raw == "" {
			continue
		}
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || (key == "page_size" && value > 100) {
			return strconv.ErrSyntax
		}
	}
	if pageInfo.Page < 1 || pageInfo.PageSize < 1 {
		return strconv.ErrSyntax
	}
	return nil
}

func parseInvoiceApplicationFilters(c *gin.Context) (model.InvoiceApplicationFilters, error) {
	filters := model.InvoiceApplicationFilters{
		Status: strings.TrimSpace(c.Query("status")),
	}
	if filters.Status != "" && filters.Status != model.InvoiceStatusApplied && filters.Status != model.InvoiceStatusProcessing && filters.Status != model.InvoiceStatusIssued && filters.Status != model.InvoiceStatusRejected {
		return filters, strconv.ErrSyntax
	}
	var err error
	if filters.Username, err = parseInvoiceFilterText(c, "username"); err != nil {
		return filters, err
	}
	if filters.Title, err = parseInvoiceFilterText(c, "title"); err != nil {
		return filters, err
	}
	if filters.TaxId, err = parseInvoiceFilterText(c, "tax_id"); err != nil {
		return filters, err
	}
	if filters.TradeNo, err = parseInvoiceFilterText(c, "trade_no"); err != nil {
		return filters, err
	}
	if raw := strings.TrimSpace(c.Query("user_id")); raw != "" {
		value, parseErr := strconv.Atoi(raw)
		if parseErr != nil || value <= 0 {
			return filters, strconv.ErrSyntax
		}
		filters.UserId = &value
	}
	if filters.GrossAmountMin, err = parseInvoiceFilterAmount(c, "gross_amount_min"); err != nil {
		return filters, err
	}
	if filters.GrossAmountMax, err = parseInvoiceFilterAmount(c, "gross_amount_max"); err != nil {
		return filters, err
	}
	if filters.RefundAmountMin, err = parseInvoiceFilterAmount(c, "refund_amount_min"); err != nil {
		return filters, err
	}
	if filters.RefundAmountMax, err = parseInvoiceFilterAmount(c, "refund_amount_max"); err != nil {
		return filters, err
	}
	if filters.NetAmountMin, err = parseInvoiceFilterAmount(c, "net_amount_min"); err != nil {
		return filters, err
	}
	if filters.NetAmountMax, err = parseInvoiceFilterAmount(c, "net_amount_max"); err != nil {
		return filters, err
	}
	if filters.CreatedAtFrom, err = parseInvoiceFilterTimestamp(c, "created_at_from"); err != nil {
		return filters, err
	}
	if filters.CreatedAtTo, err = parseInvoiceFilterTimestamp(c, "created_at_to"); err != nil {
		return filters, err
	}
	for _, pair := range [][2]*int64{
		{filters.GrossAmountMin, filters.GrossAmountMax},
		{filters.RefundAmountMin, filters.RefundAmountMax},
		{filters.NetAmountMin, filters.NetAmountMax},
		{filters.CreatedAtFrom, filters.CreatedAtTo},
	} {
		if pair[0] != nil && pair[1] != nil && *pair[0] > *pair[1] {
			return filters, strconv.ErrRange
		}
	}
	return filters, nil
}

func GetAllInvoiceApplications(c *gin.Context) {
	filters, err := parseInvoiceApplicationFilters(c)
	if err != nil {
		common.ApiErrorMsg(c, "invalid invoice filters")
		return
	}
	pageInfo := common.GetPageQuery(c)
	if err := validateInvoicePageQuery(c, pageInfo); err != nil {
		common.ApiErrorMsg(c, "invalid invoice pagination")
		return
	}
	applications, total, err := model.GetAllInvoiceApplications(filters, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(applications)
	common.ApiSuccess(c, pageInfo)
}

func RejectInvoiceApplication(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid invoice application")
		return
	}
	var request rejectInvoiceRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorMsg(c, "invalid invoice rejection request")
		return
	}
	if err := model.RejectInvoiceApplication(id, request.Reason); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func MarkInvoiceProcessing(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid invoice application")
		return
	}
	if err := model.MarkInvoiceProcessing(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func UploadInvoicePDF(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid invoice application")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxInvoicePDFSize+1024*1024)
	header, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorMsg(c, "invoice PDF is required")
		return
	}
	file, err := service.SaveInvoicePDF(id, header)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.MarkInvoiceIssued(id, file.Key, file.Name, file.Size, file.Sha256); err != nil {
		service.RemoveInvoiceFile(file.FullPath)
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func DownloadInvoicePDF(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid invoice application")
		return
	}
	application, err := model.GetInvoiceApplicationForDownload(id, c.GetInt("id"), c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	file, info, err := service.OpenInvoiceFile(application.FileKey)
	if err != nil {
		common.ApiErrorMsg(c, "invoice file is unavailable")
		return
	}
	defer file.Close()
	name := application.FileName
	if name == "" {
		name = "invoice.pdf"
	}
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	c.Header("Content-Type", "application/pdf")
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.DataFromReader(http.StatusOK, info.Size(), "application/pdf", file, nil)
}
