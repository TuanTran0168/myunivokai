package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
)

const testGatewaySecret = "test-gateway-shared-secret"

func TestGatewayRoutesAndSanitizesForwardingHeaders(t *testing.T) {
	requestReceived := make(chan *http.Request, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		requestReceived <- request.Clone(request.Context())
		responseWriter.Header().Set("Content-Type", "application/json")
		_, _ = responseWriter.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()
	router := NewRouter(testGatewayConfig(t, upstream.URL, upstream.URL))
	request := httptest.NewRequest(http.MethodGet, "/api/universe/worlds?ids=one", nil)
	request.RemoteAddr = "192.0.2.10:4321"
	request.Header.Set("X-Gateway-Key", "forged-client-value")
	request.Header.Set("X-Request-Id", "trace_123")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("gateway status = %d, body=%s", response.Code, response.Body.String())
	}
	proxiedRequest := <-requestReceived
	if proxiedRequest.URL.Path != "/api/v1/worlds" || proxiedRequest.URL.RawQuery != "ids=one" {
		t.Fatalf("upstream target = %s?%s", proxiedRequest.URL.Path, proxiedRequest.URL.RawQuery)
	}
	if credential := proxiedRequest.Header.Get("X-Gateway-Key"); credential != testGatewaySecret {
		t.Fatalf("gateway credential = %q, want configured secret", credential)
	}
	if forwardedFor := proxiedRequest.Header.Get("X-Forwarded-For"); forwardedFor != "192.0.2.10" {
		t.Fatalf("X-Forwarded-For = %q, want sanitized client address", forwardedFor)
	}
	if response.Header().Get("X-Request-Id") != "trace_123" {
		t.Fatalf("request ID was not propagated: %q", response.Header().Get("X-Request-Id"))
	}
	if values := response.Header().Values("X-Request-Id"); len(values) != 1 {
		t.Fatalf("gateway returned duplicate request IDs: %v", values)
	}
	if response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("security headers are missing")
	}
}

func TestGatewayStatusAggregatesBothUpstreams(t *testing.T) {
	readyService := func() *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			if request.URL.Path != "/api/v1/readyz" || request.Header.Get("X-Gateway-Key") != testGatewaySecret {
				responseWriter.WriteHeader(http.StatusUnauthorized)
				return
			}
			responseWriter.WriteHeader(http.StatusOK)
		}))
	}
	universe := readyService()
	defer universe.Close()
	nature := readyService()
	defer nature.Close()
	router := NewRouter(testGatewayConfig(t, universe.URL, nature.URL))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/statusz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("statusz = %d, body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		OK       bool `json:"ok"`
		Services map[string]struct {
			Ready bool `json:"ready"`
		} `json:"services"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.OK || !payload.Services["universe"].Ready || !payload.Services["nature"].Ready {
		t.Fatalf("unexpected aggregate payload: %+v", payload)
	}
}

func TestGatewayCachesOnlyPublicShareResponses(t *testing.T) {
	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		upstreamCalls.Add(1)
		responseWriter.Header().Set("Content-Type", "application/json")
		_, _ = responseWriter.Write([]byte(`{"world":"public"}`))
	}))
	defer upstream.Close()
	router := NewRouter(testGatewayConfig(t, upstream.URL, upstream.URL))
	for requestNumber := 0; requestNumber < 2; requestNumber++ {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/nature/share/worlds/grove", nil))
		if response.Code != http.StatusOK {
			t.Fatalf("share response %d = %d", requestNumber, response.Code)
		}
		if requestNumber == 1 && response.Header().Get("X-Cache") != "HIT" {
			t.Fatalf("second share request cache = %q, want HIT", response.Header().Get("X-Cache"))
		}
	}
	if calls := upstreamCalls.Load(); calls != 1 {
		t.Fatalf("upstream calls = %d, want one cached call", calls)
	}
}

func TestGatewayRejectsOversizedBodyBeforeProxy(t *testing.T) {
	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		upstreamCalls.Add(1)
		responseWriter.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	gatewayConfig := testGatewayConfig(t, upstream.URL, upstream.URL)
	gatewayConfig.MaximumRequestBodyBytes = 4
	router := NewRouter(gatewayConfig)
	request := httptest.NewRequest(http.MethodPost, "/api/universe/worlds", strings.NewReader("12345"))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge || upstreamCalls.Load() != 0 {
		t.Fatalf("status=%d upstreamCalls=%d", response.Code, upstreamCalls.Load())
	}
}

func TestGatewayMapsTransportFailureAndOpensCircuit(t *testing.T) {
	gatewayConfig := testGatewayConfig(t, "http://127.0.0.1:1", "http://127.0.0.1:1")
	gatewayConfig.CircuitBreakerFailureLimit = 1
	router := NewRouter(gatewayConfig)

	firstResponse := httptest.NewRecorder()
	router.ServeHTTP(firstResponse, httptest.NewRequest(http.MethodGet, "/api/universe/worlds", nil))
	if firstResponse.Code != http.StatusBadGateway || !strings.Contains(firstResponse.Body.String(), "UPSTREAM_UNREACHABLE") {
		t.Fatalf("first failure = %d %s", firstResponse.Code, firstResponse.Body.String())
	}
	secondResponse := httptest.NewRecorder()
	router.ServeHTTP(secondResponse, httptest.NewRequest(http.MethodGet, "/api/universe/worlds", nil))
	if secondResponse.Code != http.StatusServiceUnavailable || !strings.Contains(secondResponse.Body.String(), "UPSTREAM_CIRCUIT_OPEN") {
		t.Fatalf("open circuit = %d %s", secondResponse.Code, secondResponse.Body.String())
	}
}

func TestGatewayMapsRouteDeadlineToGatewayTimeout(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		time.Sleep(50 * time.Millisecond)
		responseWriter.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	gatewayConfig := testGatewayConfig(t, upstream.URL, upstream.URL)
	gatewayConfig.StandardProxyTimeout = 5 * time.Millisecond
	router := NewRouter(gatewayConfig)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/nature/worlds", nil))
	if response.Code != http.StatusGatewayTimeout || !strings.Contains(response.Body.String(), "UPSTREAM_TIMEOUT") {
		t.Fatalf("timeout = %d %s", response.Code, response.Body.String())
	}
}

func TestGatewayCORSIsOwnedAtThePublicEdge(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	router := NewRouter(testGatewayConfig(t, upstream.URL, upstream.URL))
	request := httptest.NewRequest(http.MethodOptions, "/api/universe/worlds", nil)
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Fatalf("preflight status=%d origin=%q", response.Code, response.Header().Get("Access-Control-Allow-Origin"))
	}
}

func testGatewayConfig(t *testing.T, universeServiceURL, natureServiceURL string) config.Config {
	t.Helper()
	parsedUniverseURL, err := url.Parse(universeServiceURL)
	if err != nil {
		t.Fatal(err)
	}
	parsedNatureURL, err := url.Parse(natureServiceURL)
	if err != nil {
		t.Fatal(err)
	}
	return config.Config{
		AppEnv:                     "test",
		AppName:                    "Gateway Test",
		AllowedOrigins:             []string{"http://localhost:3000"},
		UniverseServiceURL:         parsedUniverseURL,
		NatureServiceURL:           parsedNatureURL,
		GatewaySharedSecret:        testGatewaySecret,
		RateLimitRequestsPerSecond: 1000,
		RateLimitBurst:             1000,
		MaximumRequestBodyBytes:    64 * 1024,
		StandardProxyTimeout:       time.Second,
		CreateWorldProxyTimeout:    time.Second,
		ShareProxyTimeout:          time.Second,
		StatusCheckTimeout:         time.Second,
		ShareCacheTTL:              time.Minute,
		ShareCacheMaximumEntries:   100,
		CircuitBreakerFailureLimit: 3,
		CircuitBreakerCooldown:     time.Minute,
	}
}
