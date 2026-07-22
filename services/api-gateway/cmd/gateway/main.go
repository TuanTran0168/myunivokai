package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/broker"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/handlers"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

const (
	serverReadHeaderTimeout = 5 * time.Second
	serverReadTimeout       = 15 * time.Second
	serverWriteMargin       = 10 * time.Second
	serverIdleTimeout       = 120 * time.Second
)

func main() {
	zerolog.TimeFieldFormat = time.RFC3339
	gatewayConfig, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load gateway configuration")
	}
	brokerClient, err := broker.NewNATSClient(gatewayConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("connect gateway to NATS")
	}
	defer brokerClient.Close()
	edgeStore, err := edge.NewRedisStore(gatewayConfig.RedisURL, gatewayConfig.RedisKeyPrefix)
	if err != nil {
		log.Fatal().Err(err).Msg("create gateway Redis client")
	}
	defer func() {
		if closeError := edgeStore.Close(); closeError != nil {
			log.Error().Err(closeError).Msg("close gateway Redis client")
		}
	}()
	server := &http.Server{
		Addr:              gatewayConfig.Address(),
		Handler:           handlers.NewRouter(gatewayConfig, brokerClient, edgeStore),
		ReadHeaderTimeout: serverReadHeaderTimeout,
		ReadTimeout:       serverReadTimeout,
		WriteTimeout:      gatewayConfig.NATSPublishTimeout + gatewayConfig.NATSRequestTimeout + serverWriteMargin,
		IdleTimeout:       serverIdleTimeout,
	}
	go func() {
		log.Info().Str("addr", gatewayConfig.Address()).Msg("api gateway listening")
		if serveError := server.ListenAndServe(); serveError != nil && serveError != http.ErrServerClosed {
			log.Fatal().Err(serveError).Msg("api gateway failed")
		}
	}()
	stopSignal := make(chan os.Signal, 1)
	signal.Notify(stopSignal, os.Interrupt, syscall.SIGTERM)
	<-stopSignal
	shutdownContext, cancel := context.WithTimeout(context.Background(), gatewayConfig.ShutdownTimeout)
	defer cancel()
	if shutdownError := server.Shutdown(shutdownContext); shutdownError != nil {
		log.Error().Err(shutdownError).Msg("api gateway shutdown failed")
	}
}
