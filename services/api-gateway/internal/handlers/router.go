package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/proxy"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/routing"
)

const corsMaximumAgeSeconds = 300

func NewRouter(gatewayConfig config.Config) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestContext(gatewayConfig.TrustProxyHeaders))
	router.Use(middleware.Recover)
	router.Use(middleware.Logging)
	router.Use(middleware.SecurityHeaders)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   gatewayConfig.AllowedOrigins,
		AllowedMethods:   []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-Id"},
		ExposedHeaders:   []string{"Cache-Control", "Retry-After", "X-Cache", "X-Request-Id"},
		AllowCredentials: false,
		MaxAge:           corsMaximumAgeSeconds,
	}))

	healthHandler := NewHealthHandler(
		gatewayConfig.AppName,
		gatewayConfig.AppEnv,
		gatewayConfig.GatewaySharedSecret,
		gatewayConfig.StatusCheckTimeout,
		gatewayConfig.UniverseServiceURL,
		gatewayConfig.NatureServiceURL,
	)
	landing := landingHandler(gatewayConfig.AppName)
	router.Get("/", landing)
	router.Head("/", landing)
	router.Get("/api/v1/healthz", healthHandler.Liveness)

	rateLimit := middleware.RateLimit(gatewayConfig.RateLimitRequestsPerSecond, gatewayConfig.RateLimitBurst)
	router.With(rateLimit).Get("/api/v1/statusz", healthHandler.Status)

	timeouts := routing.Timeouts{
		Standard:    gatewayConfig.StandardProxyTimeout,
		CreateWorld: gatewayConfig.CreateWorldProxyTimeout,
		Share:       gatewayConfig.ShareProxyTimeout,
	}
	universeProxy := proxy.NewHandler(proxy.Options{
		UpstreamName:             "universe",
		PublicPrefix:             routing.UniversePrefix,
		Target:                   gatewayConfig.UniverseServiceURL,
		SharedSecret:             gatewayConfig.GatewaySharedSecret,
		TrustProxyHeaders:        gatewayConfig.TrustProxyHeaders,
		Timeouts:                 timeouts,
		ShareCacheTimeToLive:     gatewayConfig.ShareCacheTTL,
		ShareCacheMaximumEntries: gatewayConfig.ShareCacheMaximumEntries,
		CircuitFailureThreshold:  gatewayConfig.CircuitBreakerFailureLimit,
		CircuitCooldown:          gatewayConfig.CircuitBreakerCooldown,
	})
	natureProxy := proxy.NewHandler(proxy.Options{
		UpstreamName:             "nature",
		PublicPrefix:             routing.NaturePrefix,
		Target:                   gatewayConfig.NatureServiceURL,
		SharedSecret:             gatewayConfig.GatewaySharedSecret,
		TrustProxyHeaders:        gatewayConfig.TrustProxyHeaders,
		Timeouts:                 timeouts,
		ShareCacheTimeToLive:     gatewayConfig.ShareCacheTTL,
		ShareCacheMaximumEntries: gatewayConfig.ShareCacheMaximumEntries,
		CircuitFailureThreshold:  gatewayConfig.CircuitBreakerFailureLimit,
		CircuitCooldown:          gatewayConfig.CircuitBreakerCooldown,
	})
	router.Group(func(proxyRouter chi.Router) {
		proxyRouter.Use(rateLimit)
		proxyRouter.Use(middleware.BodyLimit(gatewayConfig.MaximumRequestBodyBytes))
		proxyRouter.Handle(routing.UniversePrefix, universeProxy)
		proxyRouter.Handle(routing.UniversePrefix+"/*", universeProxy)
		proxyRouter.Handle(routing.NaturePrefix, natureProxy)
		proxyRouter.Handle(routing.NaturePrefix+"/*", natureProxy)
	})
	router.NotFound(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "ROUTE_NOT_FOUND", "The requested gateway route was not found.")
	})
	router.MethodNotAllowed(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "The request method is not allowed for this route.")
	})
	return router
}

func landingHandler(appName string) http.HandlerFunc {
	return func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteJSON(responseWriter, http.StatusOK, map[string]any{
			"service": appName,
			"status":  "ok",
			"routes": map[string]string{
				"universe": routing.UniversePrefix,
				"nature":   routing.NaturePrefix,
				"health":   "/api/v1/healthz",
				"status":   "/api/v1/statusz",
			},
		})
	}
}
