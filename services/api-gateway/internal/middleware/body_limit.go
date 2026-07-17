package middleware

import (
	"net/http"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
)

func BodyLimit(maximumBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			if request.ContentLength > maximumBytes {
				httpx.WriteError(responseWriter, request, http.StatusRequestEntityTooLarge, "REQUEST_TOO_LARGE", "Request body is too large.")
				return
			}
			if request.Body != nil {
				request.Body = http.MaxBytesReader(responseWriter, request.Body, maximumBytes)
			}
			next.ServeHTTP(responseWriter, request)
		})
	}
}
