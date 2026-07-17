package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/config"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/middleware"
	httpSwagger "github.com/swaggo/http-swagger/v2"
)

// NewRouter mirrors universe-service's router: same middleware order, same
// route shapes under /api/v1, so a future gateway routes both services by
// path prefix alone and the web client reuses one API client per service.
func NewRouter(cfg config.Config, health *HealthHandler, worlds *WorldHandler, share *ShareHandler, landing *LandingHandler) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recover)
	r.Use(middleware.Logging)
	r.Use(middleware.RateLimit(cfg.RateLimitRPS, cfg.RateLimitBurst, cfg.TrustProxyHeaders))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-Id"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// A machine-friendly welcome at the bare service URL (deploy platforms
	// also HEAD this path). API consumers live under /api/v1.
	r.Get("/", landing.Handle)
	r.Head("/", landing.Handle)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/healthz", health.Handle)
		r.Get("/readyz", health.HandleReadiness)
		r.Post("/worlds", worlds.Create)
		r.Get("/worlds", worlds.GetBatch)
		r.Get("/worlds/{worldId}", worlds.Get)
		r.Post("/worlds/{worldId}/variants", worlds.RegenerateVariant)
		r.Post("/worlds/{worldId}/variants/{variantId}/select", worlds.SelectVariant)
		r.Post("/worlds/{worldId}/publish", worlds.Publish)
		r.Get("/share/worlds/{shareSlug}", share.GetWorld)
	})
	// Swagger documents the public nature API for local development without
	// exposing implementation details or an extra route in production.
	if !cfg.IsProduction() {
		r.Get("/swagger/*", httpSwagger.WrapHandler)
	}
	return r
}
