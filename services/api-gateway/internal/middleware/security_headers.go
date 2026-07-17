package middleware

import "net/http"

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		responseWriter.Header().Set("Referrer-Policy", "no-referrer")
		responseWriter.Header().Set("X-Content-Type-Options", "nosniff")
		responseWriter.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(responseWriter, request)
	})
}
