package handlers

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/broker"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

const corsMaximumAgeSeconds = 300

type EdgeStore interface {
	cacheStore
	middleware.DistributedLimiter
	Ping(context.Context) error
	Close() error
}

func NewRouter(serviceConfig config.Config, brokerClient broker.Client, edgeStore EdgeStore) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestContext(serviceConfig.TrustProxyHeaders))
	router.Use(middleware.Recover)
	router.Use(middleware.Logging)
	router.Use(middleware.SecurityHeaders)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins: serviceConfig.AllowedOrigins,
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "X-Request-Id"},
		ExposedHeaders: []string{"Cache-Control", "Retry-After", "X-Cache", "X-Request-Id"},
		MaxAge:         corsMaximumAgeSeconds,
	}))
	healthHandler := NewHealthHandler(serviceConfig.AppName, brokerClient, edgeStore)
	apiHandler := NewAPIHandler(serviceConfig, brokerClient, edgeStore)
	landingHandler := func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteJSON(responseWriter, http.StatusOK, map[string]any{"service": serviceConfig.AppName, "status": "ok", "architecture": "nats-redis"})
	}
	router.Get("/", landingHandler)
	router.Head("/", landingHandler)
	router.Get("/api/v1/healthz", healthHandler.Liveness)
	router.Get("/api/v1/readyz", healthHandler.Readiness)
	router.Get("/api/v1/statusz", healthHandler.Readiness)

	rateLimitMiddleware := middleware.RateLimit(edgeStore, serviceConfig.RateLimitRequestsPerSecond, serviceConfig.RateLimitBurst)
	router.Group(func(businessRouter chi.Router) {
		businessRouter.Use(rateLimitMiddleware)
		businessRouter.Use(middleware.BodyLimit(serviceConfig.MaximumRequestBodyBytes))
		businessRouter.Get("/api/jobs/{jobID}", apiHandler.GetJob)
		businessRouter.Route("/api/{family}", func(familyRouter chi.Router) {
			familyRouter.Post("/worlds", apiHandler.CreateWorld)
			familyRouter.Get("/worlds", apiHandler.GetWorlds)
			familyRouter.Get("/worlds/{worldID}", apiHandler.GetWorld)
			familyRouter.Post("/worlds/{worldID}/variants", apiHandler.CreateVariant)
			familyRouter.Post("/worlds/{worldID}/variants/{variantID}/select", apiHandler.SelectVariant)
			familyRouter.Post("/worlds/{worldID}/publish", apiHandler.PublishWorld)
			familyRouter.Get("/share/worlds/{shareSlug}", apiHandler.GetShare)
		})
	})
	router.NotFound(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "ROUTE_NOT_FOUND", "The requested gateway route was not found.")
	})
	router.MethodNotAllowed(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "The request method is not allowed for this route.")
	})
	return router
}
