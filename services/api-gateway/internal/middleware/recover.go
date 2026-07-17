package middleware

import (
	"net/http"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/rs/zerolog/log"
)

func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				log.Error().Interface("panic", recovered).Str("request_id", httpx.RequestID(request.Context())).Msg("gateway panic recovered")
				httpx.WriteError(responseWriter, request, http.StatusInternalServerError, "INTERNAL_ERROR", "Something went wrong.")
			}
		}()
		next.ServeHTTP(responseWriter, request)
	})
}
