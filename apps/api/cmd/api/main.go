package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/myunivokai/myunivokai/apps/api/docs"
	"github.com/myunivokai/myunivokai/apps/api/internal/aifactory"
	"github.com/myunivokai/myunivokai/apps/api/internal/config"
	"github.com/myunivokai/myunivokai/apps/api/internal/db"
	"github.com/myunivokai/myunivokai/apps/api/internal/handlers"
	"github.com/myunivokai/myunivokai/apps/api/internal/repositories"
	"github.com/myunivokai/myunivokai/apps/api/internal/services"
	"github.com/myunivokai/myunivokai/apps/api/internal/validation"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// @title Myunivokai API
// @version 0.1.0
// @description Backend API for Myunivokai personal universe generation.
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
		log.Warn().Msg("DATABASE_URL is empty; using in-memory store")
		store = repositories.NewMemoryStore()
	} else {
		store = repositories.NewPostgresStore(pool)
	}
	orchestrator, err := aifactory.NewOrchestratorFromConfig(cfg, validation.ValidatePersonalityDNA)
	if err != nil {
		log.Fatal().Err(err).Msg("configure ai")
	}
	worldService := services.NewWorldService(cfg, store, orchestrator, services.NewWorldConfigBuilder())
	router := handlers.NewRouter(cfg, handlers.NewHealthHandler(cfg, store), handlers.NewWorldHandler(worldService), handlers.NewShareHandler(worldService))
	// WriteTimeout must outlive the slowest handler, which is world creation
	// waiting on the AI provider (AITimeout per attempt, plus repair/fallback).
	serverWriteTimeout := 3*cfg.AITimeout + 10*time.Second
	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      serverWriteTimeout,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		log.Info().Str("addr", cfg.Addr()).Msg("api listening")
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
