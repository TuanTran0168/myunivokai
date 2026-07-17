package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
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

	// A machine-friendly welcome at the bare service URL (deploy platforms
	// also HEAD this path). API consumers live under /api/v1.
	r.Get("/", landing.Handle)
	r.Head("/", landing.Handle)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/healthz", health.Handle)
		r.Group(func(protectedRouter chi.Router) {
			protectedRouter.Use(middleware.GatewayAuthentication(cfg.GatewaySharedSecret))
			protectedRouter.Get("/readyz", health.HandleReadiness)
			protectedRouter.Post("/worlds", worlds.Create)
			protectedRouter.Get("/worlds", worlds.GetBatch)
			protectedRouter.Get("/worlds/{worldId}", worlds.Get)
			protectedRouter.Post("/worlds/{worldId}/variants", worlds.RegenerateVariant)
			protectedRouter.Post("/worlds/{worldId}/variants/{variantId}/select", worlds.SelectVariant)
			protectedRouter.Post("/worlds/{worldId}/publish", worlds.Publish)
			protectedRouter.Get("/share/worlds/{shareSlug}", share.GetWorld)
		})
	})
	// Swagger documents the public nature API for local development without
	// exposing implementation details or an extra route in production.
	if !cfg.IsProduction() {
		r.Get("/swagger/*", httpSwagger.WrapHandler)
	}
	return r
}
