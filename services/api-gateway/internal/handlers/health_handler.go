package handlers

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/broker"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
)

const dependencyCheckTimeout = 2 * time.Second

type dependencyPinger interface {
	Ping(context.Context) error
}

type HealthHandler struct {
	appName string
	broker  broker.Client
	redis   dependencyPinger
}

func NewHealthHandler(appName string, brokerClient broker.Client, redis dependencyPinger) *HealthHandler {
	return &HealthHandler{appName: appName, broker: brokerClient, redis: redis}
}

func (handler *HealthHandler) Liveness(responseWriter http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(responseWriter, http.StatusOK, map[string]any{"service": handler.appName, "status": "ok"})
}

func (handler *HealthHandler) Readiness(responseWriter http.ResponseWriter, request *http.Request) {
	checkContext, cancel := context.WithTimeout(request.Context(), dependencyCheckTimeout)
	defer cancel()
	statuses := map[string]string{"nats": "ready", "redis": "ready"}
	var natsError, redisError error
	var waitGroup sync.WaitGroup
	waitGroup.Add(2)
	go func() {
		defer waitGroup.Done()
		natsError = handler.broker.Ping(checkContext)
	}()
	go func() {
		defer waitGroup.Done()
		redisError = handler.redis.Ping(checkContext)
	}()
	waitGroup.Wait()
	statusCode := http.StatusOK
	if natsError != nil {
		statuses["nats"] = "unavailable"
		statusCode = http.StatusServiceUnavailable
	}
	if redisError != nil {
		statuses["redis"] = "unavailable"
		statusCode = http.StatusServiceUnavailable
	}
	httpx.WriteJSON(responseWriter, statusCode, map[string]any{"service": handler.appName, "status": http.StatusText(statusCode), "dependencies": statuses})
}
