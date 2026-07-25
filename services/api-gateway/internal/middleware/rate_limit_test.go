package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeDistributedLimiter struct {
	allowances []bool
	error      error
	calls      int
}

func (limiter *fakeDistributedLimiter) Allow(context.Context, string, string, float64, int) (bool, time.Duration, error) {
	limiter.calls++
	if limiter.error != nil {
		return false, 0, limiter.error
	}
	allowed := limiter.allowances[limiter.calls-1]
	return allowed, time.Second, nil
}

func TestRateLimitUsesDistributedPolicyAcrossRoutes(t *testing.T) {
	distributedLimiter := &fakeDistributedLimiter{allowances: []bool{true, false}}
	handler := RequestContext(false)(RateLimit(distributedLimiter, 1, 1)(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
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

func TestRateLimitFallsBackLocallyWhenRedisFails(t *testing.T) {
	distributedLimiter := &fakeDistributedLimiter{error: errors.New("redis unavailable")}
	handler := RequestContext(false)(RateLimit(distributedLimiter, 1, 1)(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
	})))
	firstResponse := httptest.NewRecorder()
	handler.ServeHTTP(firstResponse, httptest.NewRequest(http.MethodGet, "/api/universe/worlds", nil))
	secondResponse := httptest.NewRecorder()
	handler.ServeHTTP(secondResponse, httptest.NewRequest(http.MethodGet, "/api/nature/worlds", nil))
	if firstResponse.Code != http.StatusOK || secondResponse.Code != http.StatusTooManyRequests {
		t.Fatalf("fallback status codes = %d, %d; want 200 then 429", firstResponse.Code, secondResponse.Code)
	}
}
