package handlers

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
)

const maximumReadinessResponseBytes = 1024

type HealthHandler struct {
	appName        string
	appEnvironment string
	sharedSecret   string
	statusTimeout  time.Duration
	client         *http.Client
	upstreams      map[string]*url.URL
}

type serviceStatus struct {
	Ready               bool  `json:"ready"`
	HTTPStatus          int   `json:"httpStatus,omitempty"`
	LatencyMilliseconds int64 `json:"latencyMs"`
}

func NewHealthHandler(appName, appEnvironment, sharedSecret string, statusTimeout time.Duration, universeServiceURL, natureServiceURL *url.URL) *HealthHandler {
	return &HealthHandler{
		appName:        appName,
		appEnvironment: appEnvironment,
		sharedSecret:   sharedSecret,
		statusTimeout:  statusTimeout,
		client:         &http.Client{},
		upstreams: map[string]*url.URL{
			"universe": universeServiceURL,
			"nature":   natureServiceURL,
		},
	}
}

func (handler *HealthHandler) Liveness(responseWriter http.ResponseWriter, request *http.Request) {
	httpx.WriteJSON(responseWriter, http.StatusOK, map[string]any{
		"ok":        true,
		"app":       handler.appName,
		"env":       handler.appEnvironment,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func (handler *HealthHandler) Status(responseWriter http.ResponseWriter, request *http.Request) {
	type result struct {
		name   string
		status serviceStatus
	}
	results := make(chan result, len(handler.upstreams))
	var waitGroup sync.WaitGroup
	for name, upstreamURL := range handler.upstreams {
		waitGroup.Add(1)
		go func(serviceName string, serviceURL *url.URL) {
			defer waitGroup.Done()
			results <- result{name: serviceName, status: handler.checkReadiness(request.Context(), request, serviceURL)}
		}(name, upstreamURL)
	}
	waitGroup.Wait()
	close(results)

	allReady := true
	statuses := make(map[string]serviceStatus, len(handler.upstreams))
	for checked := range results {
		statuses[checked.name] = checked.status
		allReady = allReady && checked.status.Ready
	}
	statusCode := http.StatusOK
	if !allReady {
		statusCode = http.StatusServiceUnavailable
	}
	httpx.WriteJSON(responseWriter, statusCode, map[string]any{
		"ok":        allReady,
		"services":  statuses,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func (handler *HealthHandler) checkReadiness(parentContext context.Context, incomingRequest *http.Request, upstreamURL *url.URL) serviceStatus {
	startedAt := time.Now()
	status := serviceStatus{}
	checkContext, cancel := context.WithTimeout(parentContext, handler.statusTimeout)
	defer cancel()
	readinessURL := *upstreamURL
	readinessURL.Path = strings.TrimRight(readinessURL.Path, "/") + "/api/v1/readyz"
	readinessRequest, err := http.NewRequestWithContext(checkContext, http.MethodGet, readinessURL.String(), nil)
	if err != nil {
		status.LatencyMilliseconds = time.Since(startedAt).Milliseconds()
		return status
	}
	readinessRequest.Header.Set("X-Request-Id", httpx.RequestID(incomingRequest.Context()))
	if handler.sharedSecret != "" {
		readinessRequest.Header.Set("X-Gateway-Key", handler.sharedSecret)
	}
	readinessResponse, err := handler.client.Do(readinessRequest)
	if err == nil {
		status.HTTPStatus = readinessResponse.StatusCode
		status.Ready = readinessResponse.StatusCode == http.StatusOK
		_, _ = io.Copy(io.Discard, io.LimitReader(readinessResponse.Body, maximumReadinessResponseBytes))
		_ = readinessResponse.Body.Close()
	}
	status.LatencyMilliseconds = time.Since(startedAt).Milliseconds()
	return status
}
