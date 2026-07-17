package handlers

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/httpx"
	_ "github.com/myunivokai/myunivokai/services/nature-service/internal/models"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/services"
)

type ShareHandler struct {
	service *services.WorldService
}

func NewShareHandler(service *services.WorldService) *ShareHandler {
	return &ShareHandler{service: service}
}

// GetWorld returns the public projection of a published forest world by its
// share slug: no input echo, no private fields — the same public-shape rule
// universe-service follows.
// @Summary Get public forest world
// @Tags share
// @Produce json
// @Param shareSlug path string true "Share slug"
// @Success 200 {object} models.PublicWorldResponse
// @Failure 404 {object} httpx.ErrorEnvelope
// @Failure 500 {object} httpx.ErrorEnvelope
// @Router /share/worlds/{shareSlug} [get]
func (h *ShareHandler) GetWorld(w http.ResponseWriter, r *http.Request) {
	shareSlug := strings.TrimSpace(chi.URLParam(r, "shareSlug"))
	if shareSlug == "" {
		httpx.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found.", nil)
		return
	}
	response, err := h.service.GetPublicWorld(r.Context(), shareSlug)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}
