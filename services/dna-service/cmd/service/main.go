package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/myunivokai/myunivokai/services/dna-service/internal/aifactory"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/config"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/db"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/messaging"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/services"
	"github.com/rs/zerolog/log"
)

func main() {
	serviceConfig, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load dna service configuration")
	}
	runtimeContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	databasePool, err := db.Connect(runtimeContext, serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("connect dna database")
	}
	defer databasePool.Close()
	store := repositories.NewPostgresStore(databasePool)
	orchestrator, err := aifactory.NewOrchestrator(serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("create AI orchestrator")
	}
	generationService := services.NewGenerationService(serviceConfig, store, orchestrator)
	messagingRuntime, err := messaging.NewRuntime(serviceConfig, store, generationService)
	if err != nil {
		log.Fatal().Err(err).Msg("connect DNA messaging runtime")
	}
	if err := messagingRuntime.Run(runtimeContext); err != nil {
		log.Fatal().Err(err).Msg("start DNA messaging runtime")
	}
	log.Info().Msg("dna service ready")
	<-runtimeContext.Done()
	messagingRuntime.Close()
}
