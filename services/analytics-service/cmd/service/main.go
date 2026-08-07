package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/myunivokai/myunivokai/services/analytics-service/internal/config"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/db"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/messaging"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/services"
	"github.com/rs/zerolog/log"
)

const (
	defaultMigrationsDirectory = "migrations"
	defaultHealthCheckPort     = "8080"
)

// startHealthServer binds a port immediately so Render's free-tier cold start
// has an inbound HTTP target - see
// notes/vision/service-wake-mechanism.md#healthz-is-a-start-signal-not-a-readiness-signal.
// It answers 200 before the messaging runtime has finished Run().
func startHealthServer() *http.Server {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = defaultHealthCheckPort
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
	})
	server := &http.Server{Addr: ":" + port, Handler: mux}
	go func() {
		log.Info().Str("addr", server.Addr).Msg("analytics health server listening")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("analytics health server failed")
		}
	}()
	return server
}

func main() {
	serviceConfig, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load analytics service configuration")
	}
	migrationDatabaseURL := serviceConfig.DatabaseDirectURL
	if migrationDatabaseURL == "" {
		migrationDatabaseURL = serviceConfig.DatabaseURL
	}
	migrationsDirectory := os.Getenv("MIGRATIONS_DIR")
	if migrationsDirectory == "" {
		migrationsDirectory = defaultMigrationsDirectory
	}
	if err := db.Migrate(migrationDatabaseURL, migrationsDirectory); err != nil {
		log.Fatal().Err(err).Msg("run analytics database migrations")
	}
	log.Info().Msg("analytics database migrations complete")
	healthServer := startHealthServer()
	defer func() { _ = healthServer.Close() }()
	runtimeContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databasePool, err := db.Connect(runtimeContext, serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("connect analytics database")
	}
	defer databasePool.Close()

	store := repositories.NewPostgresStore(databasePool)
	messagingRuntime, err := messaging.NewRuntime(
		serviceConfig,
		services.NewAnalyticsService(store),
		services.NewProjectionService(store),
	)
	if err != nil {
		log.Fatal().Err(err).Msg("connect analytics messaging runtime")
	}
	if err := messagingRuntime.Run(runtimeContext); err != nil {
		log.Fatal().Err(err).Msg("start analytics messaging runtime")
	}
	log.Info().Msg("analytics service ready")
	<-runtimeContext.Done()
	messagingRuntime.Close()
}
