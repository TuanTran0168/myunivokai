package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRateLimitUsesOneBucketAcrossRoutes(t *testing.T) {
	handler := RequestContext(false)(RateLimit(1, 1)(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
	})))

	firstResponse := httptest.NewRecorder()
	handler.ServeHTTP(firstResponse, httptest.NewRequest(http.MethodGet, "/api/universe/worlds", nil))
	secondResponse := httptest.NewRecorder()
	handler.ServeHTTP(secondResponse, httptest.NewRequest(http.MethodGet, "/api/nature/worlds", nil))
	if firstResponse.Code != http.StatusOK || secondResponse.Code != http.StatusTooManyRequests {
		t.Fatalf("status codes = %d, %d; want 200 then 429", firstResponse.Code, secondResponse.Code)
	}
}
