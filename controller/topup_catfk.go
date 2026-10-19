package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

func RequestCatFKQuote(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorT(c, "Payment compliance confirmation is required")
		return
	}
	var req struct {
		ProductID string `json:"product_id"`
		ChannelID string `json:"channel_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ProductID == "" || req.ChannelID == "" {
		common.ApiErrorT(c, "Invalid CatFK payment request")
		return
	}
	quote, err := service.QuoteCatFK(c.Request.Context(), c.GetInt("id"), req.ProductID, req.ChannelID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, quote)
}

func RequestCatFKPay(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorT(c, "Payment compliance confirmation is required")
		return
	}
	var req service.CatFKPaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid CatFK payment request")
		return
	}
	payment, err := service.CreateCatFKPayment(c.Request.Context(), c.GetInt("id"), req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payment)
}

func GetCatFKPayment(c *gin.Context) {
	// Existing orders remain readable when new purchases are disabled.
	payment, err := service.GetUserCatFKPayment(c.GetInt("id"), c.Param("trade_no"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payment)
}

func GetCatFKRedemption(c *gin.Context) {
	redemption, err := service.GetUserCatFKRedemption(c.GetInt("id"), c.Param("trade_no"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, redemption)
}

func ListCatFKPaymentChannels(c *gin.Context) {
	var req struct {
		StoreToken string `json:"store_token"`
		Token      string `json:"token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid CatFK payment request")
		return
	}
	token := strings.TrimSpace(req.StoreToken)
	if token == "" {
		token = strings.TrimSpace(req.Token)
	}
	if token == "" {
		token = operation_setting.GetCatFKSetting().StoreToken
	}
	channels, err := service.ListCatFKChannels(c.Request.Context(), token)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, channels)
}
