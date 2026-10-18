package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// SensitiveOperationOriginGuard applies the CSRF origin check regardless of
// SESSION_COOKIE_SECURE. Online deployment changes are high-impact operations;
// allowing a missing Origin/Referer in local HTTP mode would make a browser
// session vulnerable to cross-site requests.
func SensitiveOperationOriginGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin, ok := requestBrowserOrigin(c.Request)
		if !ok || !isAllowedSessionOrigin(c.Request, origin) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"success": false,
				"code":    "AUTH_ORIGIN_FORBIDDEN",
				"message": "request origin is not allowed",
			})
			return
		}
		c.Next()
	}
}
