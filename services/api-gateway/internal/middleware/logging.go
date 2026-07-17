package middleware

import (
	"net/http"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/rs/zerolog/log"
)

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (writer *statusWriter) WriteHeader(status int) {
	writer.status = status
	writer.ResponseWriter.WriteHeader(status)
}

func (writer *statusWriter) Unwrap() http.ResponseWriter {
	return writer.ResponseWriter
}

func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		startTime := time.Now()
		wrappedWriter := &statusWriter{ResponseWriter: responseWriter, status: http.StatusOK}
		next.ServeHTTP(wrappedWriter, request)
		log.Info().
			Str("request_id", httpx.RequestID(request.Context())).
			Str("client_ip", httpx.ClientIP(request.Context())).
			Str("method", request.Method).
			Str("path", request.URL.Path).
			Int("status", wrappedWriter.status).
			Dur("duration", time.Since(startTime)).
			Msg("gateway request")
	})
}
