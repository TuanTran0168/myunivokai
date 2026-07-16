package middleware

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/httpx"
	"golang.org/x/time/rate"
)

const (
	// clientIdleTTL is how long a client's limiter survives without traffic
	// before it is eligible for cleanup.
	clientIdleTTL = 10 * time.Minute
	// cleanupInterval bounds how often the idle sweep runs. The sweep happens
	// lazily inside request handling, so no background goroutine is needed.
	cleanupInterval = time.Minute
	// retryAfterSeconds is advertised on 429 responses. The bucket refills at
	// RATE_LIMIT_RPS tokens/second, so one second is an honest lower bound for
	// when a rejected client can try again.
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

// RateLimit limits each client (by IP) independently, so one abusive client
// cannot exhaust the shared budget for everyone. RATE_LIMIT_RPS and
// RATE_LIMIT_BURST therefore apply per IP, not globally.
func RateLimit(requestsPerSecond float64, burst int, trustProxyHeaders bool) func(http.Handler) http.Handler {
	limiter := &perClientRateLimiter{
		requestsPerSecond: requestsPerSecond,
		burst:             burst,
		clients:           make(map[string]*clientLimiterEntry),
		lastCleanupTime:   time.Now(),
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !limiter.allow(clientKeyFromRequest(r, trustProxyHeaders)) {
				w.Header().Set("Retry-After", retryAfterSeconds)
				httpx.WriteError(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Please slow down.", nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (l *perClientRateLimiter) allow(clientKey string) bool {
	// Only the map bookkeeping needs l.mutex; rate.Limiter has its own internal
	// lock, so calling Allow() outside the map lock keeps concurrent requests
	// from serializing on one mutex.
	entry := l.entryForClient(clientKey)
	return entry.limiter.Allow()
}

func (l *perClientRateLimiter) entryForClient(clientKey string) *clientLimiterEntry {
	l.mutex.Lock()
	defer l.mutex.Unlock()

	now := time.Now()
	l.removeIdleClientsLocked(now)

	entry, exists := l.clients[clientKey]
	if !exists {
		entry = &clientLimiterEntry{limiter: rate.NewLimiter(rate.Limit(l.requestsPerSecond), l.burst)}
		l.clients[clientKey] = entry
	}
	entry.lastSeenTime = now
	return entry
}

func (l *perClientRateLimiter) removeIdleClientsLocked(now time.Time) {
	if now.Sub(l.lastCleanupTime) < cleanupInterval {
		return
	}
	l.lastCleanupTime = now
	for clientKey, entry := range l.clients {
		if now.Sub(entry.lastSeenTime) > clientIdleTTL {
			delete(l.clients, clientKey)
		}
	}
}

// clientKeyFromRequest identifies the caller. X-Forwarded-For is honored only
// when the deployment declares a trusted reverse proxy in front (TRUST_PROXY):
// the proxy appends the real client address as the LAST entry, so that entry
// is the only one the client cannot forge. Earlier entries — and the whole
// header when no trusted proxy exists — are attacker-controlled; keying on
// them would let one caller mint a fresh rate-limit bucket per request.
func clientKeyFromRequest(r *http.Request, trustProxyHeaders bool) string {
	if trustProxyHeaders {
		forwardedFor := r.Header.Get("X-Forwarded-For")
		if forwardedFor != "" {
			addresses := strings.Split(forwardedFor, ",")
			lastAddress := strings.TrimSpace(addresses[len(addresses)-1])
			if lastAddress != "" {
				return lastAddress
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
