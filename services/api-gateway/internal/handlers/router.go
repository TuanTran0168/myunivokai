package handlers

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/adminauth"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/broker"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

const corsMaximumAgeSeconds = 300

type EdgeStore interface {
	cacheStore
	middleware.DistributedLimiter
	adminauth.TokenVersionCache
	Ping(context.Context) error
	Close() error
}

// productRateLimitRouteKey and adminRateLimitRouteKey give the two route
// groups independent Redis token buckets. They must never be equal - see
// middleware.RateLimit.
const (
	productRateLimitRouteKey = "product"
	adminRateLimitRouteKey   = "admin"
)

func NewRouter(serviceConfig config.Config, brokerClient broker.Client, edgeStore EdgeStore) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestContext(serviceConfig.TrustProxyHeaders))
	router.Use(middleware.Recover)
	router.Use(middleware.Logging)
	router.Use(middleware.SecurityHeaders)
	healthHandler := NewHealthHandler(serviceConfig.AppName, brokerClient, edgeStore)
	rpcTransport := NewRPCTransport(serviceConfig, brokerClient, edgeStore)
	dnaJobHandler := NewDNAJobHandler(serviceConfig, rpcTransport)
	universeHandler := NewUniverseHandler(serviceConfig, brokerClient, rpcTransport)
	natureHandler := NewNatureHandler(serviceConfig, brokerClient, rpcTransport)
	landingHandler := func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteJSON(responseWriter, http.StatusOK, map[string]any{"service": serviceConfig.AppName, "status": "ok", "architecture": "nats-redis"})
	}
	router.Get("/", landingHandler)
	router.Head("/", landingHandler)
	router.Get("/api/v1/healthz", healthHandler.Liveness)
	router.Get("/api/v1/readyz", healthHandler.Readiness)
	router.Get("/api/v1/statusz", healthHandler.Readiness)

	// The product CORS handler is scoped to this group, not global - it must
	// never reach /api/admin, which mounts its own further down. See
	// notes/vision/auth-and-admin-plan.md#amended--one-gateway-two-route-groups.
	router.Group(func(businessRouter chi.Router) {
		businessRouter.Use(cors.Handler(cors.Options{
			AllowedOrigins: serviceConfig.AllowedOrigins,
			AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodOptions},
			AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "X-Request-Id"},
			ExposedHeaders: []string{"Cache-Control", "Retry-After", "X-Cache", "X-Request-Id"},
			MaxAge:         corsMaximumAgeSeconds,
		}))
		businessRouter.Use(middleware.RateLimit(edgeStore, productRateLimitRouteKey, serviceConfig.RateLimitRequestsPerSecond, serviceConfig.RateLimitBurst))
		businessRouter.Use(middleware.BodyLimit(serviceConfig.MaximumRequestBodyBytes))
		businessRouter.Get("/api/jobs/{jobID}", dnaJobHandler.GetJob)
		businessRouter.Route("/api/universe", func(familyRouter chi.Router) {
			registerWorldRoutes(familyRouter, universeHandler)
		})
		businessRouter.Route("/api/nature", func(familyRouter chi.Router) {
			registerWorldRoutes(familyRouter, natureHandler)
		})
		businessRouter.Route("/api/{family}", registerUnsupportedFamilyRoutes)
	})
	if serviceConfig.AdminRoutesEnabled {
		router.Mount("/api/admin", newAdminRouter(serviceConfig, brokerClient, edgeStore, rpcTransport))
	}
	router.NotFound(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "ROUTE_NOT_FOUND", "The requested gateway route was not found.")
	})
	router.MethodNotAllowed(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "The request method is not allowed for this route.")
	})
	return router
}

type worldRouteHandler interface {
	CreateWorld(http.ResponseWriter, *http.Request)
	GetWorlds(http.ResponseWriter, *http.Request)
	GetWorld(http.ResponseWriter, *http.Request)
	CreateVariant(http.ResponseWriter, *http.Request)
	SelectVariant(http.ResponseWriter, *http.Request)
	PublishWorld(http.ResponseWriter, *http.Request)
	GetShare(http.ResponseWriter, *http.Request)
}

func registerWorldRoutes(router chi.Router, handler worldRouteHandler) {
	router.Post("/worlds", handler.CreateWorld)
	router.Get("/worlds", handler.GetWorlds)
	router.Get("/worlds/{worldID}", handler.GetWorld)
	router.Post("/worlds/{worldID}/variants", handler.CreateVariant)
	router.Post("/worlds/{worldID}/variants/{variantID}/select", handler.SelectVariant)
	router.Post("/worlds/{worldID}/publish", handler.PublishWorld)
	router.Get("/share/worlds/{shareSlug}", handler.GetShare)
}

func registerUnsupportedFamilyRoutes(router chi.Router) {
	unsupported := func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "WORLD_FAMILY_NOT_FOUND", "The requested world family is not supported.")
	}
	router.Post("/worlds", unsupported)
	router.Get("/worlds", unsupported)
	router.Get("/worlds/{worldID}", unsupported)
	router.Post("/worlds/{worldID}/variants", unsupported)
	router.Post("/worlds/{worldID}/variants/{variantID}/select", unsupported)
	router.Post("/worlds/{worldID}/publish", unsupported)
	router.Get("/share/worlds/{shareSlug}", unsupported)
}
