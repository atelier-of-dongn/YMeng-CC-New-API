package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSetupContextForTokenForcesRetryByRoutingMode(t *testing.T) {
	tests := []struct {
		name          string
		token         *model.Token
		expectedRetry bool
	}{
		{
			name:          "single group ignores stored retry flag",
			token:         &model.Token{Group: "a", CrossGroupRetry: true},
			expectedRetry: false,
		},
		{
			name:          "multiple groups force retry",
			token:         &model.Token{Group: "a", GroupSequence: `["a","b"]`, CrossGroupRetry: false},
			expectedRetry: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			require.NoError(t, SetupContextForToken(c, test.token))
			assert.Equal(t, test.expectedRetry, common.GetContextKeyBool(c, constant.ContextKeyTokenCrossGroupRetry))
		})
	}
}
