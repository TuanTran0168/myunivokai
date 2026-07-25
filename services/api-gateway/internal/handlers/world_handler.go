package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/oklog/ulid/v2"
	"github.com/rs/zerolog/log"
)

const maximumBatchWorldIdentifiers = 50

type GenerationPublisher interface {
	PublishGeneration(context.Context, contracts.Envelope[contracts.GenerateDNAData]) error
}

type worldSubjects struct {
	worldList     string
	worldGet      string
	variantCreate string
	variantSelect string
	worldPublish  string
	shareGet      string
}

// WorldHandler implements one fixed world-family route set. Family-to-subject
// routing is constructor-owned, so request data can never select another service.
type WorldHandler struct {
	family               contracts.WorldFamily
	subjects             worldSubjects
	generationPublisher  GenerationPublisher
	transport            *RPCTransport
	publishTimeout       time.Duration
	worldCacheTimeToLive time.Duration
	shareCacheTimeToLive time.Duration
}

func newWorldHandler(serviceConfig config.Config, family contracts.WorldFamily, subjects worldSubjects, generationPublisher GenerationPublisher, transport *RPCTransport) *WorldHandler {
	return &WorldHandler{
		family: family, subjects: subjects, generationPublisher: generationPublisher, transport: transport,
		publishTimeout: serviceConfig.NATSPublishTimeout, worldCacheTimeToLive: serviceConfig.WorldCacheTimeToLive,
		shareCacheTimeToLive: serviceConfig.ShareCacheTimeToLive,
	}
}

func (handler *WorldHandler) CreateWorld(responseWriter http.ResponseWriter, request *http.Request) {
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
	job := contracts.Job{JobID: jobID, Family: handler.family, Status: contracts.JobStatusQueued, CreatedAt: createdAt, UpdatedAt: createdAt}
	publishContext, cancel := context.WithTimeout(request.Context(), handler.publishTimeout)
	defer cancel()
	command := contracts.NewEnvelope(jobID, contracts.GenerateDNAData{Family: handler.family, Input: input})
	if err := handler.generationPublisher.PublishGeneration(publishContext, command); err != nil {
		log.Error().Err(err).Str("request_id", httpx.RequestID(request.Context())).Msg("publish generation command")
		httpx.WriteError(responseWriter, request, http.StatusServiceUnavailable, "GENERATION_UNAVAILABLE", "Generation could not be accepted right now.")
		return
	}
	httpx.WriteJSON(responseWriter, http.StatusAccepted, job)
}

func (handler *WorldHandler) GetWorlds(responseWriter http.ResponseWriter, request *http.Request) {
	rawWorldIdentifiers := request.URL.Query().Get("ids")
	if strings.TrimSpace(rawWorldIdentifiers) == "" {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", "Provide ids as a comma-separated list of world IDs.")
		return
	}
	worldIdentifiers := splitIdentifiers(rawWorldIdentifiers)
	if len(worldIdentifiers) > maximumBatchWorldIdentifiers {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR", fmt.Sprintf("Too many ids; request at most %d worlds per call.", maximumBatchWorldIdentifiers))
		return
	}
	handler.transport.Proxy(responseWriter, request, handler.subjects.worldList, contracts.WorldListQueryData{WorldIDs: worldIdentifiers}, cachePolicy{})
}

func (handler *WorldHandler) GetWorld(responseWriter http.ResponseWriter, request *http.Request) {
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	cacheIdentifier := edge.WorldCacheIdentifier(string(handler.family), worldID)
	if handler.transport.WriteCacheHit(responseWriter, request, worldCacheNamespace, cacheIdentifier) {
		return
	}
	handler.transport.Proxy(responseWriter, request, handler.subjects.worldGet, contracts.WorldQueryData{WorldID: worldID}, cachePolicy{
		namespace: worldCacheNamespace, identifier: cacheIdentifier, timeToLive: handler.worldCacheTimeToLive,
	})
}

func (handler *WorldHandler) CreateVariant(responseWriter http.ResponseWriter, request *http.Request) {
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	handler.proxyWorldMutation(responseWriter, request, worldID, handler.subjects.variantCreate, contracts.VariantCreateData{WorldID: worldID})
}

func (handler *WorldHandler) SelectVariant(responseWriter http.ResponseWriter, request *http.Request) {
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	variantID := chi.URLParam(request, "variantID")
	if _, err := uuid.Parse(variantID); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found.")
		return
	}
	handler.proxyWorldMutation(responseWriter, request, worldID, handler.subjects.variantSelect, contracts.VariantSelectData{WorldID: worldID, VariantID: variantID})
}

func (handler *WorldHandler) PublishWorld(responseWriter http.ResponseWriter, request *http.Request) {
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	handler.proxyWorldMutation(responseWriter, request, worldID, handler.subjects.worldPublish, contracts.PublishWorldData{WorldID: worldID})
}

func (handler *WorldHandler) GetShare(responseWriter http.ResponseWriter, request *http.Request) {
	shareSlug := chi.URLParam(request, "shareSlug")
	cacheIdentifier := edge.ShareCacheIdentifier(string(handler.family), shareSlug)
	if handler.transport.WriteCacheHit(responseWriter, request, shareCacheNamespace, cacheIdentifier) {
		return
	}
	handler.transport.Proxy(responseWriter, request, handler.subjects.shareGet, contracts.ShareQueryData{ShareSlug: shareSlug}, cachePolicy{
		namespace: shareCacheNamespace, identifier: cacheIdentifier, timeToLive: handler.shareCacheTimeToLive,
	})
}

// Invalidate before and after a mutation to close the concurrent stale-fill race.
func (handler *WorldHandler) proxyWorldMutation(responseWriter http.ResponseWriter, request *http.Request, worldID, subject string, data any) {
	handler.transport.InvalidateWorld(request.Context(), handler.family, worldID)
	response, ok := handler.transport.Request(responseWriter, request, subject, data)
	if !ok {
		return
	}
	handler.transport.InvalidateWorld(request.Context(), handler.family, worldID)
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func worldIdentifierFromRequest(responseWriter http.ResponseWriter, request *http.Request) (string, bool) {
	worldID := chi.URLParam(request, "worldID")
	if _, err := uuid.Parse(worldID); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found.")
		return "", false
	}
	return worldID, true
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
