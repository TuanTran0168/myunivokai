package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
)

func TestRequestContextUsesFirstTrustedForwardedAddress(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.5")
	request.Header.Set("X-Request-Id", "trace_123")
	recorder := httptest.NewRecorder()
	handler := RequestContext(true)(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if clientIP := httpx.ClientIP(request.Context()); clientIP != "203.0.113.7" {
			t.Fatalf("client IP = %q, want first trusted forwarded address", clientIP)
		}
		if requestID := httpx.RequestID(request.Context()); requestID != "trace_123" {
			t.Fatalf("request ID = %q, want propagated safe ID", requestID)
		}
	}))
	handler.ServeHTTP(recorder, request)
}

func TestRequestContextReplacesUnsafeRequestID(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("X-Request-Id", "unsafe request id")
	recorder := httptest.NewRecorder()
	RequestContext(false)(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if requestID := httpx.RequestID(request.Context()); requestID == "unsafe request id" || !validRequestID(requestID) {
			t.Fatalf("unsafe request ID was not replaced: %q", requestID)
		}
	})).ServeHTTP(recorder, request)
}
