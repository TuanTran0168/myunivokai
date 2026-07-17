package middleware

import (
	"net"
	"net/http"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
)

const maximumRequestIDLength = 128

var safeRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func RequestContext(trustProxyHeaders bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			requestID := request.Header.Get("X-Request-Id")
			if !validRequestID(requestID) {
				requestID = "req_" + uuid.NewString()
			}
			clientIP := clientIPFromRequest(request, trustProxyHeaders)
			contextWithRequestID := httpx.WithRequestID(request.Context(), requestID)
			requestContext := httpx.WithClientIP(contextWithRequestID, clientIP)
			responseWriter.Header().Set("X-Request-Id", requestID)
			next.ServeHTTP(responseWriter, request.WithContext(requestContext))
		})
	}
}

func validRequestID(requestID string) bool {
	return requestID != "" && len(requestID) <= maximumRequestIDLength && safeRequestID.MatchString(requestID)
}

// Render places the real client address first in X-Forwarded-For. The header
// is trusted only when deployment explicitly declares the Render proxy.
func clientIPFromRequest(request *http.Request, trustProxyHeaders bool) string {
	if trustProxyHeaders {
		forwardedAddresses := strings.Split(request.Header.Get("X-Forwarded-For"), ",")
		if len(forwardedAddresses) > 0 {
			candidate := strings.TrimSpace(forwardedAddresses[0])
			if parsedAddress := net.ParseIP(candidate); parsedAddress != nil {
				return parsedAddress.String()
			}
		}
	}
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return request.RemoteAddr
}
