package middleware

import (
	"net/http"

	"github.com/myunivokai/myunivokai/apps/api/internal/httpx"
	"github.com/rs/zerolog/log"
)

func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				log.Error().Interface("panic", recovered).Str("request_id", httpx.RequestID(r.Context())).Msg("panic recovered")
				httpx.WriteError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Something went wrong.", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
