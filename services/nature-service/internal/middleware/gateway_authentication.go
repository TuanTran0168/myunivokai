package middleware

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/httpx"
)

const gatewayAuthenticationHeader = "X-Gateway-Key"

// GatewayAuthentication protects business routes on publicly addressable
// upstream deployments. An empty secret keeps standalone local development
// possible; production startup validation forbids that configuration.
func GatewayAuthentication(sharedSecret string) func(http.Handler) http.Handler {
	expectedSecretHash := sha256.Sum256([]byte(sharedSecret))
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			providedSecretHash := sha256.Sum256([]byte(request.Header.Get(gatewayAuthenticationHeader)))
			if sharedSecret != "" && subtle.ConstantTimeCompare(providedSecretHash[:], expectedSecretHash[:]) != 1 {
				httpx.WriteError(responseWriter, request, http.StatusUnauthorized, "GATEWAY_AUTHENTICATION_REQUIRED", "This service is available through the API gateway.", nil)
				return
			}
			request.Header.Del(gatewayAuthenticationHeader)
			next.ServeHTTP(responseWriter, request)
		})
	}
}
