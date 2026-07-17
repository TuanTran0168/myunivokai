package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGatewayAuthentication(t *testing.T) {
	const sharedSecret = "gateway-secret"
	handler := GatewayAuthentication(sharedSecret)(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if request.Header.Get(gatewayAuthenticationHeader) != "" {
			t.Fatal("gateway credential reached the business handler")
		}
		responseWriter.WriteHeader(http.StatusOK)
	}))

	unauthorizedRequest := httptest.NewRequest(http.MethodGet, "/api/v1/worlds", nil)
	unauthorizedResponse := httptest.NewRecorder()
	handler.ServeHTTP(unauthorizedResponse, unauthorizedRequest)
	if unauthorizedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("missing credential status = %d, want 401", unauthorizedResponse.Code)
	}

	authorizedRequest := httptest.NewRequest(http.MethodGet, "/api/v1/worlds", nil)
	authorizedRequest.Header.Set(gatewayAuthenticationHeader, sharedSecret)
	authorizedResponse := httptest.NewRecorder()
	handler.ServeHTTP(authorizedResponse, authorizedRequest)
	if authorizedResponse.Code != http.StatusOK {
		t.Fatalf("valid credential status = %d, want 200", authorizedResponse.Code)
	}
}
