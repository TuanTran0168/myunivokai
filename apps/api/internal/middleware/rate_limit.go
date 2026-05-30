package middleware

import (
	"net/http"

	"github.com/myunivokai/myunivokai/apps/api/internal/httpx"
	"golang.org/x/time/rate"
)

func RateLimit(rps float64, burst int) func(http.Handler) http.Handler {
	limiter := rate.NewLimiter(rate.Limit(rps), burst)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !limiter.Allow() {
				httpx.WriteError(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Please slow down.", nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
