package handlers

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/config"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/middleware"
	httpSwagger "github.com/swaggo/http-swagger/v2"
)

func NewRouter(cfg config.Config, health *HealthHandler, worlds *WorldHandler, share *ShareHandler) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recover)
	r.Use(middleware.Logging)
	r.Use(middleware.RateLimit(cfg.RateLimitRPS, cfg.RateLimitBurst))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-Id"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/healthz", health.Handle)
		r.Get("/readyz", health.HandleReadiness)
		r.Post("/worlds", worlds.Create)
		r.Get("/worlds/{worldId}", worlds.Get)
		r.Post("/worlds/{worldId}/variants", worlds.RegenerateVariant)
		r.Post("/worlds/{worldId}/variants/{variantId}/select", worlds.SelectVariant)
		r.Post("/worlds/{worldId}/publish", worlds.Publish)
		r.Get("/share/worlds/{shareSlug}", share.GetWorld)
	})
	// Swagger UI documents internal endpoints; expose it outside production only.
	if !isProductionEnvironment(cfg.AppEnv) {
		r.Get("/swagger/*", httpSwagger.WrapHandler)
	}
	return r
}

func isProductionEnvironment(appEnv string) bool {
	normalized := strings.ToLower(strings.TrimSpace(appEnv))
	return normalized == "production" || normalized == "prod"
}
