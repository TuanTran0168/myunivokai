package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/httpx"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/services"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/validation"
	"github.com/rs/zerolog/log"
)

// maximumRequestBodyBytes bounds JSON request bodies; the world input payload
// is at most a few kilobytes, so 64 KiB leaves generous headroom.
const maximumRequestBodyBytes = 64 * 1024

// maximumBatchWorldIDs bounds GET /worlds?ids= so one request cannot ask the
// store for an unbounded id list.
const maximumBatchWorldIDs = 50

// aiUnavailableRetryAfterSeconds is advertised on 503 responses when the AI
// provider is unreachable; transient provider hiccups usually clear quickly.
const aiUnavailableRetryAfterSeconds = "5"

type WorldHandler struct {
	service *services.WorldService
}

func NewWorldHandler(service *services.WorldService) *WorldHandler {
	return &WorldHandler{service: service}
}

// requireUUIDPathParameter validates a path parameter as a UUID before it
// reaches the storage layer. A malformed ID is simply a resource that cannot
// exist, so respond 404 (and, once postgres lands, never let a malformed UUID
// surface as a query error / 500).
func requireUUIDPathParameter(w http.ResponseWriter, r *http.Request, parameterName string) (string, bool) {
	parameterValue := chi.URLParam(r, parameterName)
	if _, err := uuid.Parse(parameterValue); err != nil {
		httpx.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found.", nil)
		return "", false
	}
	return parameterValue, true
}

// Create generates a personal forest world: input → Nature DNA (AI, mock by
// default) → deterministic forest config → stored world with variant 1.
func (h *WorldHandler) Create(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maximumRequestBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input models.WorldInput
	if err := decoder.Decode(&input); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			httpx.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Request body is too large.", nil)
			return
		}
		httpx.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid JSON body.", nil)
		return
	}
	input = validation.NormalizeWorldInput(input)
	if details := validation.ValidateWorldInput(input); len(details) > 0 {
		httpx.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Please check the highlighted fields.", details)
		return
	}
	response, err := h.service.CreateWorld(r.Context(), input)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, response)
}

// Get returns a private forest world by ID.
func (h *WorldHandler) Get(w http.ResponseWriter, r *http.Request) {
	worldID, ok := requireUUIDPathParameter(w, r, "worldId")
	if !ok {
		return
	}
	response, err := h.service.GetWorld(r.Context(), worldID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

// GetBatch returns multiple private worlds in one request. Unknown or
// malformed ids are omitted from the result instead of failing the batch, so
// the caller maps requested ids against returned worlds to detect gaps.
func (h *WorldHandler) GetBatch(w http.ResponseWriter, r *http.Request) {
	rawIDs := r.URL.Query().Get("ids")
	if strings.TrimSpace(rawIDs) == "" {
		httpx.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Provide ids as a comma-separated list of world IDs.", nil)
		return
	}
	worldIDs := parseBatchWorldIDs(rawIDs)
	if len(worldIDs) > maximumBatchWorldIDs {
		httpx.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Too many ids; request at most 50 worlds per call.", nil)
		return
	}
	response, err := h.service.GetWorlds(r.Context(), worldIDs)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

// parseBatchWorldIDs splits, trims, dedupes (keeping first occurrence), and
// drops malformed UUIDs — a malformed id is a world that cannot exist, so it
// is treated as missing rather than rejecting the whole batch.
func parseBatchWorldIDs(rawIDs string) []string {
	parts := strings.Split(rawIDs, ",")
	seen := make(map[string]bool, len(parts))
	worldIDs := make([]string, 0, len(parts))
	for _, part := range parts {
		candidate := strings.TrimSpace(part)
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true
		if _, err := uuid.Parse(candidate); err != nil {
			continue
		}
		worldIDs = append(worldIDs, candidate)
	}
	return worldIDs
}

// RegenerateVariant creates a new visual variant without calling AI — a new
// seed re-rolls season, weather, wind and wildlife over the same DNA.
func (h *WorldHandler) RegenerateVariant(w http.ResponseWriter, r *http.Request) {
	worldID, ok := requireUUIDPathParameter(w, r, "worldId")
	if !ok {
		return
	}
	response, err := h.service.RegenerateVariant(r.Context(), worldID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, response)
}

// SelectVariant marks a variant as selected.
func (h *WorldHandler) SelectVariant(w http.ResponseWriter, r *http.Request) {
	worldID, ok := requireUUIDPathParameter(w, r, "worldId")
	if !ok {
		return
	}
	variantID, ok := requireUUIDPathParameter(w, r, "variantId")
	if !ok {
		return
	}
	response, err := h.service.SelectVariant(r.Context(), worldID, variantID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

// Publish makes a world public and returns its share link.
func (h *WorldHandler) Publish(w http.ResponseWriter, r *http.Request) {
	worldID, ok := requireUUIDPathParameter(w, r, "worldId")
	if !ok {
		return
	}
	response, err := h.service.PublishWorld(r.Context(), worldID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, repositories.ErrNotFound):
		httpx.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found.", nil)
	case errors.Is(err, services.ErrAIUnavailable):
		log.Error().Err(err).Str("requestId", httpx.RequestID(r.Context())).Str("path", r.URL.Path).Msg("ai provider unavailable")
		w.Header().Set("Retry-After", aiUnavailableRetryAfterSeconds)
		httpx.WriteError(w, r, http.StatusServiceUnavailable, "AI_UNAVAILABLE", "The AI service is temporarily unavailable. Please try again in a moment.", nil)
	case errors.Is(err, services.ErrInvalidAIOutput):
		log.Error().Err(err).Str("requestId", httpx.RequestID(r.Context())).Str("path", r.URL.Path).Msg("ai output rejected")
		httpx.WriteError(w, r, http.StatusBadGateway, "AI_OUTPUT_INVALID", "The AI response could not be used. Please try again.", nil)
	default:
		// The client gets a generic message; the real cause must land in the
		// logs or production 500s are undiagnosable.
		log.Error().Err(err).Str("requestId", httpx.RequestID(r.Context())).Str("path", r.URL.Path).Msg("unhandled service error")
		httpx.WriteError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Something went wrong.", nil)
	}
}
