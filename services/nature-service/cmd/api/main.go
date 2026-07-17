package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/myunivokai/myunivokai/services/nature-service/docs"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/aifactory"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/config"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/db"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/handlers"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/services"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/validation"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// @title Myunivokai Nature API
// @version 0.1.0
// @description Backend API for Myunivokai personal forest generation.
// @BasePath /api/v1
func main() {
	zerolog.TimeFieldFormat = time.RFC3339
	cfg := config.Load()
	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("connect database")
	}
	if pool != nil {
		defer pool.Close()
	}
	var store repositories.Store
	if pool == nil {
		// In production a silent in-memory fallback would mean every forest
		// world vanishes on restart/scale with readiness still green — fail
		// fast so the misconfiguration is caught at deploy time instead.
		if cfg.IsProduction() {
			log.Fatal().Msg("DATABASE_URL must be set in production; refusing to start with the in-memory store")
		}
		log.Warn().Msg("DATABASE_URL is empty; using in-memory store")
		store = repositories.NewMemoryStore()
	} else {
		store = repositories.NewPostgresStore(pool)
	}
	orchestrator, err := aifactory.NewOrchestratorFromConfig(cfg, validation.ValidateNatureDNA)
	if err != nil {
		log.Fatal().Err(err).Msg("configure ai")
	}
	worldService := services.NewWorldService(cfg, store, orchestrator, services.NewForestConfigBuilder())
	router := handlers.NewRouter(cfg, handlers.NewHealthHandler(cfg, store), handlers.NewWorldHandler(worldService), handlers.NewShareHandler(worldService), handlers.NewLandingHandler(cfg))
	// WriteTimeout must outlive the slowest handler, which is world creation:
	// the orchestrator's total budget caps all AI attempts combined, and the
	// margin covers validation, storage, and response writing.
	serverWriteTimeout := cfg.AITotalBudget + 10*time.Second
	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      serverWriteTimeout,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		log.Info().Str("addr", cfg.Addr()).Msg("nature api listening")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server failed")
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("server shutdown failed")
	}
}
