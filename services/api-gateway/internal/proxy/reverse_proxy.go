package proxy

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/routing"
	"github.com/rs/zerolog/log"
)

const maximumCacheableResponseBytes = 1024 * 1024

const (
	transportDialTimeout            = 5 * time.Second
	transportKeepAlive              = 30 * time.Second
	transportIdleConnectionTimeout  = 90 * time.Second
	transportTLSHandshakeTimeout    = 5 * time.Second
	transportExpectContinueTimeout  = time.Second
	transportMaximumIdleConnections = 100
	transportMaximumIdlePerHost     = 20
	clientClosedRequestStatus       = 499
)

type Handler struct {
	upstreamName      string
	publicPrefix      string
	target            *url.URL
	sharedSecret      string
	trustProxyHeaders bool
	timeouts          routing.Timeouts
	cacheTimeToLive   time.Duration
	reverseProxy      *httputil.ReverseProxy
	circuitBreaker    *CircuitBreaker
	responseCache     *ResponseCache
}

type Options struct {
	UpstreamName             string
	PublicPrefix             string
	Target                   *url.URL
	SharedSecret             string
	TrustProxyHeaders        bool
	Timeouts                 routing.Timeouts
	ShareCacheTimeToLive     time.Duration
	ShareCacheMaximumEntries int
	CircuitFailureThreshold  int
	CircuitCooldown          time.Duration
}

func NewHandler(options Options) *Handler {
	handler := &Handler{
		upstreamName:      options.UpstreamName,
		publicPrefix:      options.PublicPrefix,
		target:            options.Target,
		sharedSecret:      options.SharedSecret,
		trustProxyHeaders: options.TrustProxyHeaders,
		timeouts:          options.Timeouts,
		cacheTimeToLive:   options.ShareCacheTimeToLive,
		circuitBreaker:    NewCircuitBreaker(options.CircuitFailureThreshold, options.CircuitCooldown),
		responseCache:     NewResponseCache(options.ShareCacheTimeToLive, options.ShareCacheMaximumEntries),
	}
	handler.reverseProxy = &httputil.ReverseProxy{
		Rewrite:        handler.rewriteRequest,
		ModifyResponse: handler.modifyResponse,
		ErrorHandler:   handler.handleProxyError,
		Transport:      newUpstreamTransport(),
	}
	return handler
}

func (handler *Handler) ServeHTTP(responseWriter http.ResponseWriter, request *http.Request) {
	relativePath := strings.TrimPrefix(request.URL.Path, handler.publicPrefix)
	if relativePath == "" || relativePath[0] != '/' {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "ROUTE_NOT_FOUND", "The requested gateway route was not found.")
		return
	}
	policy := routing.PolicyFor(request.Method, relativePath, handler.timeouts)
	cacheKey := handler.upstreamName + ":" + relativePath + "?" + request.URL.RawQuery
	if policy.CacheShare {
		if entry, found := handler.responseCache.Get(cacheKey); found {
			copyHeaders(responseWriter.Header(), entry.headers)
			responseWriter.Header().Set("X-Cache", "HIT")
			responseWriter.WriteHeader(entry.status)
			_, _ = responseWriter.Write(entry.body)
			return
		}
	}
	if !handler.circuitBreaker.Allow() {
		retryAfterDuration := handler.circuitBreaker.RetryAfter()
		retryAfterSeconds := int((retryAfterDuration + time.Second - 1) / time.Second)
		if retryAfterSeconds < 1 {
			retryAfterSeconds = 1
		}
		responseWriter.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds))
		httpx.WriteError(responseWriter, request, http.StatusServiceUnavailable, "UPSTREAM_CIRCUIT_OPEN", "The upstream service is temporarily unavailable.")
		return
	}

	timedContext, cancel := context.WithTimeout(request.Context(), policy.Timeout)
	defer cancel()
	upstreamRequest := request.Clone(timedContext)
	upstreamRequest.URL.Path = routing.UpstreamAPIPrefix + relativePath
	upstreamRequest.URL.RawPath = ""
	if policy.CacheShare {
		bufferedWriter := newBufferedResponseWriter()
		handler.reverseProxy.ServeHTTP(bufferedWriter, upstreamRequest)
		copyHeaders(responseWriter.Header(), bufferedWriter.headers)
		responseWriter.Header().Set("X-Cache", "MISS")
		if bufferedWriter.status == http.StatusOK && bufferedWriter.body.Len() <= maximumCacheableResponseBytes && bufferedWriter.headers.Get("Set-Cookie") == "" {
			cacheControl := "public, max-age=" + strconv.Itoa(int(handler.cacheTimeToLive.Seconds()))
			responseWriter.Header().Set("Cache-Control", cacheControl)
			bufferedWriter.headers.Set("Cache-Control", cacheControl)
			handler.responseCache.Set(cacheKey, bufferedWriter.status, bufferedWriter.headers, bufferedWriter.body.Bytes())
		}
		responseWriter.WriteHeader(bufferedWriter.status)
		_, _ = responseWriter.Write(bufferedWriter.body.Bytes())
		return
	}
	handler.reverseProxy.ServeHTTP(responseWriter, upstreamRequest)
}

func (handler *Handler) rewriteRequest(proxyRequest *httputil.ProxyRequest) {
	proxyRequest.SetURL(handler.target)
	proxyRequest.Out.Host = handler.target.Host
	proxyRequest.Out.Header.Del("Forwarded")
	proxyRequest.Out.Header.Del("X-Forwarded-For")
	proxyRequest.Out.Header.Del("X-Forwarded-Host")
	proxyRequest.Out.Header.Del("X-Forwarded-Proto")
	proxyRequest.Out.Header.Del("X-Gateway-Key")
	proxyRequest.Out.Header.Set("X-Forwarded-For", httpx.ClientIP(proxyRequest.In.Context()))
	proxyRequest.Out.Header.Set("X-Forwarded-Host", proxyRequest.In.Host)
	proxyRequest.Out.Header.Set("X-Forwarded-Proto", handler.originalRequestScheme(proxyRequest.In))
	proxyRequest.Out.Header.Set("X-Request-Id", httpx.RequestID(proxyRequest.In.Context()))
	if handler.sharedSecret != "" {
		proxyRequest.Out.Header.Set("X-Gateway-Key", handler.sharedSecret)
	}
}

func (handler *Handler) originalRequestScheme(request *http.Request) string {
	if handler.trustProxyHeaders {
		forwardedScheme := strings.ToLower(strings.TrimSpace(request.Header.Get("X-Forwarded-Proto")))
		if forwardedScheme == "http" || forwardedScheme == "https" {
			return forwardedScheme
		}
	}
	if request.TLS != nil {
		return "https"
	}
	return "http"
}

func (handler *Handler) modifyResponse(response *http.Response) error {
	handler.circuitBreaker.RecordSuccess()
	response.Header.Del("Server")
	// RequestContext already set the gateway-owned response header. The
	// upstream echoes the propagated value; keeping it would produce a duplicate
	// comma-separated header at the public edge.
	response.Header.Del("X-Request-Id")
	return nil
}

func (handler *Handler) handleProxyError(responseWriter http.ResponseWriter, request *http.Request, proxyError error) {
	var maximumBytesError *http.MaxBytesError
	if errors.As(proxyError, &maximumBytesError) {
		httpx.WriteError(responseWriter, request, http.StatusRequestEntityTooLarge, "REQUEST_TOO_LARGE", "Request body is too large.")
		return
	}
	if errors.Is(request.Context().Err(), context.Canceled) {
		responseWriter.WriteHeader(clientClosedRequestStatus)
		return
	}
	handler.circuitBreaker.RecordFailure()
	status := http.StatusBadGateway
	code := "UPSTREAM_UNREACHABLE"
	message := "The upstream service could not be reached."
	if errors.Is(request.Context().Err(), context.DeadlineExceeded) || errors.Is(proxyError, context.DeadlineExceeded) {
		status = http.StatusGatewayTimeout
		code = "UPSTREAM_TIMEOUT"
		message = "The upstream service took too long to respond."
	}
	log.Error().Err(proxyError).
		Str("upstream", handler.upstreamName).
		Str("request_id", httpx.RequestID(request.Context())).
		Msg("gateway upstream failure")
	httpx.WriteError(responseWriter, request, status, code, message)
}

type bufferedResponseWriter struct {
	headers http.Header
	status  int
	body    bytes.Buffer
}

func newBufferedResponseWriter() *bufferedResponseWriter {
	return &bufferedResponseWriter{headers: make(http.Header), status: http.StatusOK}
}

func (writer *bufferedResponseWriter) Header() http.Header {
	return writer.headers
}

func (writer *bufferedResponseWriter) WriteHeader(status int) {
	writer.status = status
}

func (writer *bufferedResponseWriter) Write(payload []byte) (int, error) {
	return writer.body.Write(payload)
}

func copyHeaders(destination, source http.Header) {
	for key, values := range source {
		if protectedGatewayHeader(key) {
			continue
		}
		destination.Del(key)
		for _, value := range values {
			destination.Add(key, value)
		}
	}
}

func protectedGatewayHeader(key string) bool {
	if strings.EqualFold(key, "X-Request-Id") || strings.EqualFold(key, "Server") {
		return true
	}
	if strings.HasPrefix(strings.ToLower(key), "access-control-") {
		return true
	}
	switch http.CanonicalHeaderKey(key) {
	case "Content-Security-Policy", "Referrer-Policy", "X-Content-Type-Options", "X-Frame-Options":
		return true
	default:
		return false
	}
}

func newUpstreamTransport() *http.Transport {
	return &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   transportDialTimeout,
			KeepAlive: transportKeepAlive,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          transportMaximumIdleConnections,
		MaxIdleConnsPerHost:   transportMaximumIdlePerHost,
		IdleConnTimeout:       transportIdleConnectionTimeout,
		TLSHandshakeTimeout:   transportTLSHandshakeTimeout,
		ExpectContinueTimeout: transportExpectContinueTimeout,
	}
}

func (handler *Handler) String() string {
	return fmt.Sprintf("%s -> %s", handler.publicPrefix, handler.target.Redacted())
}
