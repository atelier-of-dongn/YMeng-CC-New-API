package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestSensitiveOperationOriginGuardRejectsMissingOrigin(t *testing.T) {
	previousTrustedURLs := common.SessionCookieTrustedURLs
	common.SessionCookieTrustedURLs = nil
	t.Cleanup(func() { common.SessionCookieTrustedURLs = previousTrustedURLs })

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/update", SensitiveOperationOriginGuard(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodPost, "https://panel.example.com/update", nil)
	request.Host = "panel.example.com"
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusForbidden, response.Code)
}

func TestSensitiveOperationOriginGuardAllowsExactSameOrigin(t *testing.T) {
	previousTrustedURLs := common.SessionCookieTrustedURLs
	common.SessionCookieTrustedURLs = nil
	t.Cleanup(func() { common.SessionCookieTrustedURLs = previousTrustedURLs })

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/update", SensitiveOperationOriginGuard(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodPost, "https://panel.example.com/update", nil)
	request.Host = "panel.example.com"
	request.Header.Set("Origin", "https://panel.example.com")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusNoContent, response.Code)
}
