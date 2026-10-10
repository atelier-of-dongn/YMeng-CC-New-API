package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/siteupdate"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"net/http"
)

func GetSystemUpdateStatus(c *gin.Context) {
	status, err := service.SystemUpdateStatus(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": status})
}

func GetSystemUpdateReleases(c *gin.Context) {
	var releases siteupdate.ReleaseList
	if err := service.SystemUpdateRequest(c.Request.Context(), http.MethodGet, "/v1/releases", nil, &releases); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": releases})
}

func StartSystemUpdate(c *gin.Context) {
	// A custom header cannot be sent by cross-origin HTML forms. Dashboard
	// authorization is required independently by the route's RootAuth middleware.
	if c.GetHeader("X-Requested-With") != "YMeng-Update" {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "update request header is required"})
		return
	}
	var request siteupdate.UpdateRequest
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request); err != nil || request.Tag == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid update version"})
		return
	}
	var status siteupdate.Status
	if err := service.SystemUpdateRequest(c.Request.Context(), http.MethodPost, "/v1/update", request, &status); err != nil {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"success": true, "data": status})
}
