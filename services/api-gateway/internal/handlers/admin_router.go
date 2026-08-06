package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

const adminCORSMaximumAgeSeconds = 300

// newAdminRouter builds the /api/admin sub-router with its own middleware
// stack - a distinct CORS handler (exactly one origin, credentialed so the
// session cookies travel), its own rate limit bucket, and default-deny by
// construction: every route below requires either nothing (login) or a
// presented refresh cookie (refresh, logout), and nothing here falls through
// to an unauthenticated handler. See
// notes/vision/auth-and-admin-plan.md#amended--one-gateway-two-route-groups.
func newAdminRouter(serviceConfig config.Config, edgeStore EdgeStore, transport *RPCTransport) http.Handler {
	adminRouter := chi.NewRouter()
	adminRouter.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{serviceConfig.AdminAllowedOrigin},
		AllowedMethods:   []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowedHeaders:   []string{"Accept", "Content-Type", "X-Request-Id"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: true,
		MaxAge:           adminCORSMaximumAgeSeconds,
	}))
	adminRouter.Use(middleware.RateLimit(edgeStore, adminRateLimitRouteKey, serviceConfig.AdminRateLimitRequestsPerSecond, serviceConfig.AdminRateLimitBurst))
	adminRouter.Use(middleware.BodyLimit(serviceConfig.MaximumRequestBodyBytes))

	authHandler := NewAdminAuthHandler(serviceConfig, transport)
	adminRouter.Post("/auth/login", authHandler.Login)
	adminRouter.With(middleware.RequireAdminRefreshCookie).Post("/auth/refresh", authHandler.Refresh)
	adminRouter.With(middleware.RequireAdminRefreshCookie).Post("/auth/logout", authHandler.Logout)

	adminRouter.NotFound(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "ROUTE_NOT_FOUND", "The requested gateway route was not found.")
	})
	adminRouter.MethodNotAllowed(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "The request method is not allowed for this route.")
	})
	return adminRouter
}
