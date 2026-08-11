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
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
	wakefactory "github.com/myunivokai/myunivokai/services/api-gateway/internal/wake/factory"
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
	processStartedAt := time.Now()
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
	// Built here, not inside the router, so an unusable SERVICE_WAKE_PLATFORM
	// stops the deploy at startup instead of producing a gateway that silently
	// never wakes anything - the same fail-fast dna-service gets from
	// aifactory.NewOrchestrator.
	wakeCoordinator, err := wakefactory.NewCoordinator(gatewayConfig, edgeStore, edgeStore)
	if err != nil {
		log.Fatal().Err(err).Msg("configure gateway service wake")
	}
	logServiceWake(wakeCoordinator)
	server := &http.Server{
		Addr:              gatewayConfig.Address(),
		Handler:           handlers.NewRouter(gatewayConfig, brokerClient, edgeStore, wakeCoordinator),
		ReadHeaderTimeout: serverReadHeaderTimeout,
		ReadTimeout:       serverReadTimeout,
		WriteTimeout:      gatewayConfig.NATSPublishTimeout + gatewayConfig.NATSRequestTimeout + serverWriteMargin,
		IdleTimeout:       serverIdleTimeout,
	}
	// Announced once the router is built and the server is about to listen,
	// which is where this process becomes useful. Never fatal: a gateway that
	// cannot describe its own boot is still a working gateway.
	announceContext, cancelAnnounce := context.WithTimeout(context.Background(), gatewayConfig.NATSPublishTimeout)
	if err := brokerClient.PublishServiceStarted(announceContext, time.Since(processStartedAt)); err != nil {
		log.Error().Err(err).Msg("announce gateway service start")
	}
	cancelAnnounce()
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

// logServiceWake states what this deploy can actually wake, which is not
// always what it was configured to wake.
//
// The http adapter needs the target's public URL, and on a scale-to-zero host
// that URL does not exist until the service behind it has been created - so a
// first deploy legitimately starts with some or all of them missing. That is a
// stage, not a failure, and the gateway must serve traffic through it. What it
// must not do is pass through it quietly: a wake platform that reaches nobody
// looks exactly like the defect this mechanism was built to fix, and the only
// difference visible from outside is this line.
func logServiceWake(coordinator *wake.Coordinator) {
	platformName := string(coordinator.PlatformName())
	if platformName == string(wake.PlatformNone) {
		log.Info().Str("wake_platform", platformName).Msg("service wake disabled; a sleeping service reports SERVICE_UNAVAILABLE")
		return
	}
	wakeable := coordinator.WakeableServices()
	if len(wakeable) == 0 {
		log.Warn().
			Str("wake_platform", platformName).
			Msg("service wake configured but no service URL is set, so nothing can be woken; set DNA_SERVICE_URL and the rest once the services exist")
		return
	}
	logEvent := log.Info()
	if len(wakeable) < len(wake.Services) {
		logEvent = log.Warn()
	}
	logEvent.
		Str("wake_platform", platformName).
		Strs("wakeable_services", wakeable).
		Int("unwakeable_services", len(wake.Services)-len(wakeable)).
		Msg("service wake ready")
}
