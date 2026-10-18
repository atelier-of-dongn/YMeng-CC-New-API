package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// UpdateLifecycleTracker prevents new business requests after the proxy has
// switched slots while allowing requests already in the old slot to finish.
func UpdateLifecycleTracker() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.BeginUpdateRequest() {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"code":    "UPDATE_DRAINING",
				"message": "this instance is draining; retry through the active instance",
			})
			return
		}
		defer common.EndUpdateRequest()
		c.Next()
	}
}
