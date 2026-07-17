package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"golang.org/x/time/rate"
)

const (
	clientIdleTTL     = 10 * time.Minute
	cleanupInterval   = time.Minute
	retryAfterSeconds = "1"
)

type clientLimiterEntry struct {
	limiter      *rate.Limiter
	lastSeenTime time.Time
}

type perClientRateLimiter struct {
	requestsPerSecond float64
	burst             int
	mutex             sync.Mutex
	clients           map[string]*clientLimiterEntry
	lastCleanupTime   time.Time
}

func RateLimit(requestsPerSecond float64, burst int) func(http.Handler) http.Handler {
	limiter := &perClientRateLimiter{
		requestsPerSecond: requestsPerSecond,
		burst:             burst,
		clients:           make(map[string]*clientLimiterEntry),
		lastCleanupTime:   time.Now(),
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			if !limiter.allow(httpx.ClientIP(request.Context())) {
				responseWriter.Header().Set("Retry-After", retryAfterSeconds)
				httpx.WriteError(responseWriter, request, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Please slow down.")
				return
			}
			next.ServeHTTP(responseWriter, request)
		})
	}
}

func (limiter *perClientRateLimiter) allow(clientIP string) bool {
	return limiter.entryForClient(clientIP).limiter.Allow()
}

func (limiter *perClientRateLimiter) entryForClient(clientIP string) *clientLimiterEntry {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()
	now := time.Now()
	limiter.removeIdleClientsLocked(now)
	entry, exists := limiter.clients[clientIP]
	if !exists {
		entry = &clientLimiterEntry{limiter: rate.NewLimiter(rate.Limit(limiter.requestsPerSecond), limiter.burst)}
		limiter.clients[clientIP] = entry
	}
	entry.lastSeenTime = now
	return entry
}

func (limiter *perClientRateLimiter) removeIdleClientsLocked(now time.Time) {
	if now.Sub(limiter.lastCleanupTime) < cleanupInterval {
		return
	}
	limiter.lastCleanupTime = now
	for clientIP, entry := range limiter.clients {
		if now.Sub(entry.lastSeenTime) > clientIdleTTL {
			delete(limiter.clients, clientIP)
		}
	}
}
