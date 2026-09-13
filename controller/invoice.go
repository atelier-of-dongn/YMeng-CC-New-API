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

func GetAllInvoiceApplications(c *gin.Context) {
	status := strings.TrimSpace(c.Query("status"))
	if status != "" && status != model.InvoiceStatusApplied && status != model.InvoiceStatusProcessing && status != model.InvoiceStatusIssued && status != model.InvoiceStatusRejected {
		common.ApiErrorMsg(c, "invalid invoice status")
		return
	}
	pageInfo := common.GetPageQuery(c)
	applications, total, err := model.GetAllInvoiceApplications(status, pageInfo)
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
	path, err := service.ResolveInvoiceFile(application.FileKey)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	name := application.FileName
	if name == "" {
		name = "invoice.pdf"
	}
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	c.Header("Content-Type", "application/pdf")
	c.File(path)
}
