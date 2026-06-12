package middleware

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/httpx"
	"golang.org/x/time/rate"
)

const (
	// clientIdleTTL is how long a client's limiter survives without traffic
	// before it is eligible for cleanup.
	clientIdleTTL = 10 * time.Minute
	// cleanupInterval bounds how often the idle sweep runs. The sweep happens
	// lazily inside request handling, so no background goroutine is needed.
	cleanupInterval = time.Minute
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
func RateLimit(requestsPerSecond float64, burst int) func(http.Handler) http.Handler {
	limiter := &perClientRateLimiter{
		requestsPerSecond: requestsPerSecond,
		burst:             burst,
		clients:           make(map[string]*clientLimiterEntry),
		lastCleanupTime:   time.Now(),
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !limiter.allow(clientKeyFromRequest(r)) {
				httpx.WriteError(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Please slow down.", nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (l *perClientRateLimiter) allow(clientKey string) bool {
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
	return entry.limiter.Allow()
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

// clientKeyFromRequest identifies the caller. Behind a reverse proxy
// (Railway/Fly/Render all set it) the first X-Forwarded-For address is the
// real client; locally it falls back to the connection's remote address.
func clientKeyFromRequest(r *http.Request) string {
	forwardedFor := r.Header.Get("X-Forwarded-For")
	if forwardedFor != "" {
		firstAddress := strings.TrimSpace(strings.Split(forwardedFor, ",")[0])
		if firstAddress != "" {
			return firstAddress
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
