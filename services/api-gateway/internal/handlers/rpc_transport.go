package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/rs/zerolog/log"
)

const (
	jobCacheNamespace   = "job:v1"
	worldCacheNamespace = "world:v1"
	shareCacheNamespace = "share:v1"
)

type cacheStore interface {
	Get(context.Context, string, string) ([]byte, error)
	Set(context.Context, string, string, []byte, time.Duration) error
	Delete(context.Context, string, string) error
}

type RPCRequester interface {
	Request(context.Context, string, any) (contracts.Envelope[contracts.RPCResponseData], error)
}

type cachePolicy struct {
	namespace  string
	identifier string
	timeToLive time.Duration
}

// RPCTransport centralizes the Gateway-to-service request/reply contract and cache behavior.
type RPCTransport struct {
	requester RPCRequester
	cache     cacheStore
	timeout   time.Duration
}

func NewRPCTransport(serviceConfig config.Config, requester RPCRequester, cache cacheStore) *RPCTransport {
	return &RPCTransport{requester: requester, cache: cache, timeout: serviceConfig.NATSRequestTimeout}
}

func (transport *RPCTransport) Proxy(responseWriter http.ResponseWriter, request *http.Request, subject string, data any, policy cachePolicy) {
	response, ok := transport.Request(responseWriter, request, subject, data)
	if !ok {
		return
	}
	if policy.namespace != "" {
		if err := transport.cache.Set(request.Context(), policy.namespace, policy.identifier, response.Data.Payload, policy.timeToLive); err != nil {
			log.Warn().Err(err).Str("cache_namespace", policy.namespace).Msg("cache service response")
		}
		responseWriter.Header().Set("X-Cache", "MISS")
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (transport *RPCTransport) Request(responseWriter http.ResponseWriter, request *http.Request, subject string, data any) (contracts.Envelope[contracts.RPCResponseData], bool) {
	requestContext, cancel := context.WithTimeout(request.Context(), transport.timeout)
	defer cancel()
	requestID := httpx.RequestID(request.Context())
	response, err := transport.requester.Request(requestContext, subject, contracts.NewEnvelope(requestID, data))
	if err != nil {
		statusCode := http.StatusServiceUnavailable
		errorCode := "SERVICE_UNAVAILABLE"
		errorMessage := "The requested service is temporarily unavailable."
		if errors.Is(err, context.DeadlineExceeded) {
			statusCode = http.StatusGatewayTimeout
			errorCode = "SERVICE_TIMEOUT"
			errorMessage = "The requested service took too long to respond."
		}
		log.Error().Err(err).Str("subject", subject).Str("request_id", requestID).Msg("NATS request failed")
		httpx.WriteError(responseWriter, request, statusCode, errorCode, errorMessage)
		return contracts.Envelope[contracts.RPCResponseData]{}, false
	}
	if response.Data.Error != nil {
		statusCode := response.Data.StatusCode
		if statusCode < http.StatusBadRequest || statusCode > 599 {
			statusCode = http.StatusBadGateway
		}
		if len(response.Data.Error.Details) == 0 {
			httpx.WriteError(responseWriter, request, statusCode, response.Data.Error.Code, response.Data.Error.Message)
		} else {
			httpx.WriteErrorWithDetails(responseWriter, request, statusCode, response.Data.Error.Code, response.Data.Error.Message, response.Data.Error.Details)
		}
		return contracts.Envelope[contracts.RPCResponseData]{}, false
	}
	if response.Data.StatusCode < http.StatusOK || response.Data.StatusCode > 299 || len(response.Data.Payload) == 0 || !json.Valid(response.Data.Payload) {
		httpx.WriteError(responseWriter, request, http.StatusBadGateway, "INVALID_SERVICE_RESPONSE", "The service returned an invalid response.")
		return contracts.Envelope[contracts.RPCResponseData]{}, false
	}
	return response, true
}

func (transport *RPCTransport) WriteCacheHit(responseWriter http.ResponseWriter, request *http.Request, namespace, identifier string) bool {
	payload, err := transport.cache.Get(request.Context(), namespace, identifier)
	if err == nil {
		responseWriter.Header().Set("X-Cache", "HIT")
		httpx.WriteRawJSON(responseWriter, http.StatusOK, payload)
		return true
	}
	if !errors.Is(err, edge.ErrCacheMiss) {
		log.Warn().Err(err).Str("cache_namespace", namespace).Msg("read cache")
	}
	return false
}

func (transport *RPCTransport) StoreCache(ctx context.Context, namespace, identifier string, payload []byte, timeToLive time.Duration) error {
	return transport.cache.Set(ctx, namespace, identifier, payload, timeToLive)
}

func (transport *RPCTransport) InvalidateWorld(ctx context.Context, family contracts.WorldFamily, worldID string) {
	if err := transport.cache.Delete(ctx, worldCacheNamespace, edge.WorldCacheIdentifier(string(family), worldID)); err != nil {
		log.Warn().Err(err).Str("world_id", worldID).Msg("invalidate world cache")
	}
}
