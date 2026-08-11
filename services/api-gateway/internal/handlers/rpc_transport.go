package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
	"github.com/nats-io/nats.go"
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

// ServiceWaker is wake.Coordinator's request-path surface, kept as an
// interface for the same reason EdgeStore is one: the handlers depend on the
// behaviour, not on Redis and an outbound HTTP client, so a test can assert
// what was woken without either. A nil value is safe - *wake.Coordinator's
// methods tolerate a nil receiver - so the gateway may hold one
// unconditionally instead of branching at every call site.
type ServiceWaker interface {
	Supports(service string) bool
	Wake(service string)
	Seen(service string)
	RetryAfter() time.Duration
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
	waker     ServiceWaker
	timeout   time.Duration
}

func NewRPCTransport(serviceConfig config.Config, requester RPCRequester, cache cacheStore, waker ServiceWaker) *RPCTransport {
	return &RPCTransport{requester: requester, cache: cache, waker: waker, timeout: serviceConfig.NATSRequestTimeout}
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
		statusCode, errorCode, errorMessage := transport.classifyTransportError(responseWriter, subject, err)
		log.Error().Err(err).Str("subject", subject).Str("request_id", requestID).Str("error_code", errorCode).Msg("NATS request failed")
		httpx.WriteError(responseWriter, request, statusCode, errorCode, errorMessage)
		return contracts.Envelope[contracts.RPCResponseData]{}, false
	}
	// A reply arrived, so the service was running at this instant - which is
	// recorded here rather than below, because a business error is still a
	// reply. "The account was not found" proves the responder is alive just as
	// well as a world does, and treating it as evidence of sleep would make
	// every validation failure look like a cold start.
	if transport.waker != nil {
		transport.waker.Seen(wake.ServiceForSubject(subject))
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

// Wake starts a service this request is about to depend on, before any
// failure exists. It returns immediately and reports nothing; see
// wake.Coordinator.Wake for why waiting is not an option.
//
// It lives on the transport so that the waker has exactly one owner, the same
// way the cache does - a handler holding its own copy would be a second place
// to keep in step.
func (transport *RPCTransport) Wake(service string) {
	if transport.waker == nil {
		return
	}
	transport.waker.Wake(service)
}

// classifyTransportError turns a NATS transport failure into the status a
// client needs in order to decide whether retrying is worth anything - the
// distinction this gateway used to discard by collapsing everything except a
// deadline into one SERVICE_UNAVAILABLE.
//
// The three cases are genuinely different events: a deadline means the
// service is awake but slow, no-responders means nobody is subscribed at all,
// and anything else is a broker-level fault. Only the middle one is worth
// waking anybody over, and only the middle one is safe to tell a client to
// retry hard on.
//
// The classification outlives the wake ping. no-responders is not unique to
// scale-to-zero hosting - it also occurs during a rolling deploy, a
// crash-restart, an OOM-kill and a scale-down - so this split stays correct
// after the ping is removed on a paid plan. See
// notes/vision/service-wake-mechanism.md#removal-when-leaving-free-tier.
func (transport *RPCTransport) classifyTransportError(responseWriter http.ResponseWriter, subject string, err error) (int, string, string) {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout, "SERVICE_TIMEOUT", "The requested service took too long to respond."
	case errors.Is(err, nats.ErrNoResponders):
		// SERVICE_WAKING is only honest when something is actually being
		// woken. With no wake platform configured - an always-on host, or a
		// service nobody supplied a URL for - a caller told to retry would
		// retry forever against a responder that is never coming back, so
		// this stays SERVICE_UNAVAILABLE.
		service := wake.ServiceForSubject(subject)
		if transport.waker == nil || !transport.waker.Supports(service) {
			return http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "The requested service is temporarily unavailable."
		}
		transport.waker.Wake(service)
		responseWriter.Header().Set("Retry-After", strconv.Itoa(edge.RetryAfterSeconds(transport.waker.RetryAfter())))
		return http.StatusServiceUnavailable, "SERVICE_WAKING", "The requested service is starting up. Please retry in a moment."
	default:
		return http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "The requested service is temporarily unavailable."
	}
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

// InvalidateShare drops the cached public share response for a slug. The share
// cache is keyed by SLUG while mutations arrive keyed by WORLD ID, so the slug
// has to come back from the domain service in the mutation response; an empty
// slug means the world was never published and there is nothing to drop.
func (transport *RPCTransport) InvalidateShare(ctx context.Context, family contracts.WorldFamily, shareSlug string) {
	if shareSlug == "" {
		return
	}
	if err := transport.cache.Delete(ctx, shareCacheNamespace, edge.ShareCacheIdentifier(string(family), shareSlug)); err != nil {
		log.Warn().Err(err).Str("share_slug", shareSlug).Msg("invalidate share cache")
	}
}
