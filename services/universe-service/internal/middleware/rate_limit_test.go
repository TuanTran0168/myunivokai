package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func performRequest(t *testing.T, handler http.Handler, remoteAddr, forwardedFor string) int {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = remoteAddr
	if forwardedFor != "" {
		request.Header.Set("X-Forwarded-For", forwardedFor)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder.Code
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestRateLimitIsIndependentPerClient(t *testing.T) {
	requestsPerSecond := 0.001 // effectively no refill during the test
	burst := 2
	handler := RateLimit(requestsPerSecond, burst)(okHandler())

	clientA := "10.0.0.1:1111"
	clientB := "10.0.0.2:2222"

	for requestNumber := 1; requestNumber <= burst; requestNumber++ {
		if code := performRequest(t, handler, clientA, ""); code != http.StatusOK {
			t.Fatalf("client A request %d: expected 200, got %d", requestNumber, code)
		}
	}
	if code := performRequest(t, handler, clientA, ""); code != http.StatusTooManyRequests {
		t.Fatalf("client A over burst: expected 429, got %d", code)
	}
	if code := performRequest(t, handler, clientB, ""); code != http.StatusOK {
		t.Fatalf("client B must not be affected by client A, got %d", code)
	}
}

func TestRateLimitSetsRetryAfterOn429(t *testing.T) {
	requestsPerSecond := 0.001
	burst := 1
	handler := RateLimit(requestsPerSecond, burst)(okHandler())

	client := "10.0.0.3:3333"
	if code := performRequest(t, handler, client, ""); code != http.StatusOK {
		t.Fatalf("first request: expected 200, got %d", code)
	}

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = client
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("over burst: expected 429, got %d", recorder.Code)
	}
	if retryAfter := recorder.Header().Get("Retry-After"); retryAfter == "" {
		t.Fatal("429 response must carry a Retry-After header so clients know when to retry")
	}
}

func TestRateLimitUsesForwardedForHeader(t *testing.T) {
	requestsPerSecond := 0.001
	burst := 1
	handler := RateLimit(requestsPerSecond, burst)(okHandler())

	sharedProxyAddr := "172.16.0.9:4000"

	if code := performRequest(t, handler, sharedProxyAddr, "203.0.113.7"); code != http.StatusOK {
		t.Fatalf("first request from forwarded client: expected 200, got %d", code)
	}
	if code := performRequest(t, handler, sharedProxyAddr, "203.0.113.7"); code != http.StatusTooManyRequests {
		t.Fatalf("same forwarded client over burst: expected 429, got %d", code)
	}
	if code := performRequest(t, handler, sharedProxyAddr, "203.0.113.8"); code != http.StatusOK {
		t.Fatalf("different forwarded client behind same proxy: expected 200, got %d", code)
	}
}
