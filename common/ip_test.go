package common

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestGetClientCountry(t *testing.T) {
	cases := []struct {
		name    string
		headers map[string]string
		want    string
	}{
		{
			name:    "no header",
			headers: map[string]string{},
			want:    "",
		},
		{
			name:    "client country header wins over cloudflare",
			headers: map[string]string{"X-Client-Country": "CN", "CF-IPCountry": "US"},
			want:    "CN",
		},
		{
			name:    "fallback to cloudflare header",
			headers: map[string]string{"CF-IPCountry": "jp"},
			want:    "JP",
		},
		{
			name:    "invalid client country falls back to cloudflare",
			headers: map[string]string{"X-Client-Country": "CHN", "CF-IPCountry": "CN"},
			want:    "CN",
		},
		{
			name:    "lowercase and spaces normalized",
			headers: map[string]string{"X-Client-Country": " cn "},
			want:    "CN",
		},
		{
			name:    "unknown marker XX dropped",
			headers: map[string]string{"X-Client-Country": "XX"},
			want:    "",
		},
		{
			name:    "tor marker T1 dropped",
			headers: map[string]string{"CF-IPCountry": "T1"},
			want:    "",
		},
		{
			name:    "non alphabetic dropped",
			headers: map[string]string{"X-Client-Country": "C1"},
			want:    "",
		},
	}

	gin.SetMode(gin.TestMode)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			for key, value := range tc.headers {
				c.Request.Header.Set(key, value)
			}
			assert.Equal(t, tc.want, GetClientCountry(c))
		})
	}
}
