package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRateLimitBlocksAfterBurstPerClient(t *testing.T) {
	handler := RateLimit(1, 2, false)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	performRequest := func(remoteAddr string) int {
		request := httptest.NewRequest(http.MethodGet, "/api/v1/worlds", nil)
		request.RemoteAddr = remoteAddr
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder.Code
	}

	if performRequest("10.0.0.1:1111") != http.StatusOK {
		t.Fatalf("first request within burst must pass")
	}
	if performRequest("10.0.0.1:1111") != http.StatusOK {
		t.Fatalf("second request within burst must pass")
	}
	if performRequest("10.0.0.1:1111") != http.StatusTooManyRequests {
		t.Fatalf("third immediate request must be rate limited")
	}
	// A different client keeps its own bucket.
	if performRequest("10.0.0.2:2222") != http.StatusOK {
		t.Fatalf("another client must not inherit the exhausted bucket")
	}
}
