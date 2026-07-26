package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/config"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/db"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/messaging"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/services"
	"github.com/rs/zerolog/log"
)

const defaultMigrationsDirectory = "migrations"

func main() {
	serviceConfig, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load nature service configuration")
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
		log.Fatal().Err(err).Msg("run nature database migrations")
	}
	log.Info().Msg("nature database migrations complete")
	runtimeContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	databasePool, err := db.Connect(runtimeContext, serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("connect nature database")
	}
	defer databasePool.Close()
	store := repositories.NewPostgresStore(databasePool)
	worldService := services.NewWorldService(serviceConfig, store, services.NewForestConfigBuilder())
	messagingRuntime, err := messaging.NewRuntime(serviceConfig, store, worldService)
	if err != nil {
		log.Fatal().Err(err).Msg("connect nature messaging runtime")
	}
	if err := messagingRuntime.Run(runtimeContext); err != nil {
		log.Fatal().Err(err).Msg("start nature messaging runtime")
	}
	log.Info().Msg("nature service ready")
	<-runtimeContext.Done()
	messagingRuntime.Close()
}
