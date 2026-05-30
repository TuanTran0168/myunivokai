package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/myunivokai/myunivokai/apps/api/internal/httpx"
	"github.com/myunivokai/myunivokai/apps/api/internal/models"
	"github.com/myunivokai/myunivokai/apps/api/internal/repositories"
	"github.com/myunivokai/myunivokai/apps/api/internal/services"
	"github.com/myunivokai/myunivokai/apps/api/internal/validation"
)

type WorldHandler struct {
	service *services.WorldService
}

func NewWorldHandler(service *services.WorldService) *WorldHandler {
	return &WorldHandler{service: service}
}

// Create creates a personal universe.
// @Summary Create universe
// @Tags worlds
// @Accept json
// @Produce json
// @Param input body models.WorldInput true "World input"
// @Success 201 {object} models.CreateWorldResponse
// @Failure 400 {object} httpx.ErrorEnvelope
// @Failure 502 {object} httpx.ErrorEnvelope
// @Failure 500 {object} httpx.ErrorEnvelope
// @Router /worlds [post]
func (h *WorldHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.WorldInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
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

// Get returns a private world by ID.
// @Summary Get universe
// @Tags worlds
// @Produce json
// @Param worldId path string true "World ID"
// @Success 200 {object} models.WorldResponse
// @Failure 404 {object} httpx.ErrorEnvelope
// @Failure 500 {object} httpx.ErrorEnvelope
// @Router /worlds/{worldId} [get]
func (h *WorldHandler) Get(w http.ResponseWriter, r *http.Request) {
	response, err := h.service.GetWorld(r.Context(), chi.URLParam(r, "worldId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

// RegenerateVariant creates a new visual variant without calling AI.
// @Summary Regenerate universe variant
// @Tags worlds
// @Produce json
// @Param worldId path string true "World ID"
// @Success 201 {object} models.VariantResponse
// @Failure 404 {object} httpx.ErrorEnvelope
// @Failure 500 {object} httpx.ErrorEnvelope
// @Router /worlds/{worldId}/variants [post]
func (h *WorldHandler) RegenerateVariant(w http.ResponseWriter, r *http.Request) {
	response, err := h.service.RegenerateVariant(r.Context(), chi.URLParam(r, "worldId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, response)
}

// SelectVariant marks a variant as selected.
// @Summary Select universe variant
// @Tags worlds
// @Produce json
// @Param worldId path string true "World ID"
// @Param variantId path string true "Variant ID"
// @Success 200 {object} models.VariantResponse
// @Failure 404 {object} httpx.ErrorEnvelope
// @Failure 500 {object} httpx.ErrorEnvelope
// @Router /worlds/{worldId}/variants/{variantId}/select [post]
func (h *WorldHandler) SelectVariant(w http.ResponseWriter, r *http.Request) {
	response, err := h.service.SelectVariant(r.Context(), chi.URLParam(r, "worldId"), chi.URLParam(r, "variantId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

// Publish makes a world public and returns an Orbit Link.
// @Summary Publish universe
// @Tags worlds
// @Produce json
// @Param worldId path string true "World ID"
// @Success 200 {object} models.PublishResponse
// @Failure 404 {object} httpx.ErrorEnvelope
// @Failure 500 {object} httpx.ErrorEnvelope
// @Router /worlds/{worldId}/publish [post]
func (h *WorldHandler) Publish(w http.ResponseWriter, r *http.Request) {
	response, err := h.service.PublishWorld(r.Context(), chi.URLParam(r, "worldId"))
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
	case errors.Is(err, services.ErrInvalidAIOutput):
		httpx.WriteError(w, r, http.StatusBadGateway, "AI_OUTPUT_INVALID", "The AI response could not be used. Please try again.", nil)
	default:
		httpx.WriteError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Something went wrong.", nil)
	}
}
