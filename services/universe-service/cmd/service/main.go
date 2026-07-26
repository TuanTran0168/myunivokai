package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/config"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/db"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/messaging"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/services"
	"github.com/rs/zerolog/log"
)

const defaultMigrationsDirectory = "migrations"

func main() {
	serviceConfig, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load universe service configuration")
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
		log.Fatal().Err(err).Msg("run universe database migrations")
	}
	log.Info().Msg("universe database migrations complete")
	runtimeContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	databasePool, err := db.Connect(runtimeContext, serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("connect universe database")
	}
	defer databasePool.Close()
	store := repositories.NewPostgresStore(databasePool)
	worldService := services.NewWorldService(serviceConfig, store, services.NewWorldConfigBuilder())
	messagingRuntime, err := messaging.NewRuntime(serviceConfig, store, worldService)
	if err != nil {
		log.Fatal().Err(err).Msg("connect universe messaging runtime")
	}
	if err := messagingRuntime.Run(runtimeContext); err != nil {
		log.Fatal().Err(err).Msg("start universe messaging runtime")
	}
	log.Info().Msg("universe service ready")
	<-runtimeContext.Done()
	messagingRuntime.Close()
}
