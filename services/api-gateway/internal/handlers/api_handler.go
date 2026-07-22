package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/broker"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/oklog/ulid/v2"
	"github.com/rs/zerolog/log"
)

const (
	jobCacheNamespace    = "job:v1"
	worldCacheNamespace  = "world:v1"
	shareCacheNamespace  = "share:v1"
	maximumBatchWorldIDs = 50
	activeJobCacheTTL    = time.Second
)

type cacheStore interface {
	Get(context.Context, string, string) ([]byte, error)
	Set(context.Context, string, string, []byte, time.Duration) error
	Delete(context.Context, string, string) error
}

type APIHandler struct {
	config config.Config
	broker broker.Client
	cache  cacheStore
}

func NewAPIHandler(serviceConfig config.Config, brokerClient broker.Client, cache cacheStore) *APIHandler {
	return &APIHandler{config: serviceConfig, broker: brokerClient, cache: cache}
}

func (handler *APIHandler) CreateWorld(responseWriter http.ResponseWriter, request *http.Request) {
	family, validFamily := familyFromRequest(request)
	if !validFamily {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "WORLD_FAMILY_NOT_FOUND", "The requested world family is not supported.")
		return
	}
	var input contracts.WorldInput
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "INVALID_JSON", "The request body must be valid JSON.")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "INVALID_JSON", "The request body must contain one JSON object.")
		return
	}
	input = input.Normalize()
	if details := input.Validate(); len(details) > 0 {
		httpx.WriteErrorWithDetails(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "Please check the highlighted fields.", details)
		return
	}
	jobID := ulid.Make().String()
	createdAt := time.Now().UTC()
	job := contracts.Job{JobID: jobID, Family: family, Status: contracts.JobStatusQueued, CreatedAt: createdAt, UpdatedAt: createdAt}
	publishContext, cancel := context.WithTimeout(request.Context(), handler.config.NATSPublishTimeout)
	defer cancel()
	if err := handler.broker.PublishGeneration(publishContext, contracts.NewEnvelope(jobID, contracts.GenerateDNAData{Family: family, Input: input})); err != nil {
		log.Error().Err(err).Str("request_id", httpx.RequestID(request.Context())).Msg("publish generation command")
		httpx.WriteError(responseWriter, request, http.StatusServiceUnavailable, "GENERATION_UNAVAILABLE", "Generation could not be accepted right now.")
		return
	}
	httpx.WriteJSON(responseWriter, http.StatusAccepted, job)
}

func (handler *APIHandler) GetJob(responseWriter http.ResponseWriter, request *http.Request) {
	jobID := chi.URLParam(request, "jobID")
	if handler.writeCacheHit(responseWriter, request, jobCacheNamespace, jobID) {
		return
	}
	handler.proxyJobQuery(responseWriter, request, jobID)
}

func (handler *APIHandler) GetWorlds(responseWriter http.ResponseWriter, request *http.Request) {
	_, subjects, validFamily := subjectsFromRequest(request)
	if !validFamily {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "WORLD_FAMILY_NOT_FOUND", "The requested world family is not supported.")
		return
	}
	rawWorldIDs := request.URL.Query().Get("ids")
	if strings.TrimSpace(rawWorldIDs) == "" {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "Provide ids as a comma-separated list of world IDs.")
		return
	}
	worldIDs := splitIdentifiers(rawWorldIDs)
	if len(worldIDs) > maximumBatchWorldIDs {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "Too many ids; request at most 50 worlds per call.")
		return
	}
	handler.proxyRPC(responseWriter, request, subjects.worldList, contracts.WorldListQueryData{WorldIDs: worldIDs}, cachePolicy{})
}

func (handler *APIHandler) GetWorld(responseWriter http.ResponseWriter, request *http.Request) {
	family, subjects, validFamily := subjectsFromRequest(request)
	if !validFamily {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "WORLD_FAMILY_NOT_FOUND", "The requested world family is not supported.")
		return
	}
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	cacheIdentifier := edge.WorldCacheIdentifier(string(family), worldID)
	if handler.writeCacheHit(responseWriter, request, worldCacheNamespace, cacheIdentifier) {
		return
	}
	handler.proxyRPC(responseWriter, request, subjects.worldGet, contracts.WorldQueryData{WorldID: worldID}, cachePolicy{namespace: worldCacheNamespace, identifier: cacheIdentifier, timeToLive: handler.config.WorldCacheTimeToLive})
}

func (handler *APIHandler) CreateVariant(responseWriter http.ResponseWriter, request *http.Request) {
	family, subjects, validFamily := subjectsFromRequest(request)
	if !validFamily {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "WORLD_FAMILY_NOT_FOUND", "The requested world family is not supported.")
		return
	}
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	handler.proxyWorldMutationRPC(responseWriter, request, family, worldID, subjects.variantCreate, contracts.VariantCreateData{WorldID: worldID})
}

func (handler *APIHandler) SelectVariant(responseWriter http.ResponseWriter, request *http.Request) {
	family, subjects, validFamily := subjectsFromRequest(request)
	if !validFamily {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "WORLD_FAMILY_NOT_FOUND", "The requested world family is not supported.")
		return
	}
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	variantID := chi.URLParam(request, "variantID")
	if _, err := uuid.Parse(variantID); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found.")
		return
	}
	handler.proxyWorldMutationRPC(responseWriter, request, family, worldID, subjects.variantSelect, contracts.VariantSelectData{WorldID: worldID, VariantID: variantID})
}

func (handler *APIHandler) PublishWorld(responseWriter http.ResponseWriter, request *http.Request) {
	family, subjects, validFamily := subjectsFromRequest(request)
	if !validFamily {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "WORLD_FAMILY_NOT_FOUND", "The requested world family is not supported.")
		return
	}
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	handler.proxyWorldMutationRPC(responseWriter, request, family, worldID, subjects.worldPublish, contracts.PublishWorldData{WorldID: worldID})
}

func (handler *APIHandler) GetShare(responseWriter http.ResponseWriter, request *http.Request) {
	family, subjects, validFamily := subjectsFromRequest(request)
	if !validFamily {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "WORLD_FAMILY_NOT_FOUND", "The requested world family is not supported.")
		return
	}
	shareSlug := chi.URLParam(request, "shareSlug")
	cacheIdentifier := edge.ShareCacheIdentifier(string(family), shareSlug)
	if handler.writeCacheHit(responseWriter, request, shareCacheNamespace, cacheIdentifier) {
		return
	}
	handler.proxyRPC(responseWriter, request, subjects.shareGet, contracts.ShareQueryData{ShareSlug: shareSlug}, cachePolicy{namespace: shareCacheNamespace, identifier: cacheIdentifier, timeToLive: handler.config.ShareCacheTimeToLive})
}

type familySubjects struct {
	worldList     string
	worldGet      string
	variantCreate string
	variantSelect string
	worldPublish  string
	shareGet      string
}

func subjectsFromRequest(request *http.Request) (contracts.WorldFamily, familySubjects, bool) {
	family, validFamily := familyFromRequest(request)
	if !validFamily {
		return "", familySubjects{}, false
	}
	if family == contracts.WorldFamilyUniverse {
		return family, familySubjects{
			worldList: contracts.UniverseWorldListQuerySubject, worldGet: contracts.UniverseWorldGetQuerySubject,
			variantCreate: contracts.UniverseVariantCreateSubject, variantSelect: contracts.UniverseVariantSelectSubject,
			worldPublish: contracts.UniverseWorldPublishSubject, shareGet: contracts.UniverseShareGetQuerySubject,
		}, true
	}
	return family, familySubjects{
		worldList: contracts.NatureWorldListQuerySubject, worldGet: contracts.NatureWorldGetQuerySubject,
		variantCreate: contracts.NatureVariantCreateSubject, variantSelect: contracts.NatureVariantSelectSubject,
		worldPublish: contracts.NatureWorldPublishSubject, shareGet: contracts.NatureShareGetQuerySubject,
	}, true
}

func familyFromRequest(request *http.Request) (contracts.WorldFamily, bool) {
	family := contracts.WorldFamily(chi.URLParam(request, "family"))
	return family, family.Valid()
}

func worldIdentifierFromRequest(responseWriter http.ResponseWriter, request *http.Request) (string, bool) {
	worldID := chi.URLParam(request, "worldID")
	if _, err := uuid.Parse(worldID); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found.")
		return "", false
	}
	return worldID, true
}

type cachePolicy struct {
	namespace  string
	identifier string
	timeToLive time.Duration
}

func (handler *APIHandler) proxyJobQuery(responseWriter http.ResponseWriter, request *http.Request, jobID string) {
	response, ok := handler.requestRPC(responseWriter, request, contracts.DNAJobGetQuerySubject, contracts.JobQueryData{JobID: jobID})
	if !ok {
		return
	}
	var job contracts.Job
	if err := json.Unmarshal(response.Data.Payload, &job); err != nil || job.JobID != jobID {
		httpx.WriteError(responseWriter, request, http.StatusBadGateway, "INVALID_SERVICE_RESPONSE", "The service returned an invalid job response.")
		return
	}
	cacheTimeToLive := handler.config.JobCacheTimeToLive
	if job.Status == contracts.JobStatusQueued || job.Status == contracts.JobStatusProcessing {
		cacheTimeToLive = activeJobCacheTTL
	}
	if err := handler.cache.Set(request.Context(), jobCacheNamespace, jobID, response.Data.Payload, cacheTimeToLive); err != nil {
		log.Warn().Err(err).Str("job_id", jobID).Msg("cache job response")
	}
	responseWriter.Header().Set("X-Cache", "MISS")
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *APIHandler) proxyRPC(responseWriter http.ResponseWriter, request *http.Request, subject string, data any, policy cachePolicy) {
	response, ok := handler.requestRPC(responseWriter, request, subject, data)
	if !ok {
		return
	}
	if policy.namespace != "" {
		if err := handler.cache.Set(request.Context(), policy.namespace, policy.identifier, response.Data.Payload, policy.timeToLive); err != nil {
			log.Warn().Err(err).Str("cache_namespace", policy.namespace).Msg("cache service response")
		}
		responseWriter.Header().Set("X-Cache", "MISS")
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

// Invalidate on both sides of a mutation. The first delete prevents normal
// post-mutation reads from seeing an old entry; the second closes the race in
// which a concurrent GET misses, reads the pre-mutation world, and fills the
// cache while the domain mutation is still in flight.
func (handler *APIHandler) proxyWorldMutationRPC(responseWriter http.ResponseWriter, request *http.Request, family contracts.WorldFamily, worldID, subject string, data any) {
	handler.invalidateWorld(request.Context(), family, worldID)
	response, ok := handler.requestRPC(responseWriter, request, subject, data)
	if !ok {
		return
	}
	handler.invalidateWorld(request.Context(), family, worldID)
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *APIHandler) requestRPC(responseWriter http.ResponseWriter, request *http.Request, subject string, data any) (contracts.Envelope[contracts.RPCResponseData], bool) {
	requestContext, cancel := context.WithTimeout(request.Context(), handler.config.NATSRequestTimeout)
	defer cancel()
	requestID := httpx.RequestID(request.Context())
	response, err := handler.broker.Request(requestContext, subject, contracts.NewEnvelope(requestID, data))
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

func (handler *APIHandler) writeCacheHit(responseWriter http.ResponseWriter, request *http.Request, namespace, identifier string) bool {
	payload, err := handler.cache.Get(request.Context(), namespace, identifier)
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

func (handler *APIHandler) invalidateWorld(ctx context.Context, family contracts.WorldFamily, worldID string) {
	if err := handler.cache.Delete(ctx, worldCacheNamespace, edge.WorldCacheIdentifier(string(family), worldID)); err != nil {
		log.Warn().Err(err).Str("world_id", worldID).Msg("invalidate world cache")
	}
}

func splitIdentifiers(rawIdentifiers string) []string {
	parts := strings.Split(rawIdentifiers, ",")
	identifiers := make([]string, 0, len(parts))
	seenIdentifiers := make(map[string]struct{})
	for _, part := range parts {
		identifier := strings.TrimSpace(part)
		if identifier == "" {
			continue
		}
		if _, found := seenIdentifiers[identifier]; found {
			continue
		}
		seenIdentifiers[identifier] = struct{}{}
		if _, err := uuid.Parse(identifier); err != nil {
			continue
		}
		identifiers = append(identifiers, identifier)
	}
	return identifiers
}
