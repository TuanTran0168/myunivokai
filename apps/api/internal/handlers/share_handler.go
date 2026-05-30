package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/myunivokai/myunivokai/apps/api/internal/httpx"
	_ "github.com/myunivokai/myunivokai/apps/api/internal/models"
	"github.com/myunivokai/myunivokai/apps/api/internal/services"
)

type ShareHandler struct {
	service *services.WorldService
}

func NewShareHandler(service *services.WorldService) *ShareHandler {
	return &ShareHandler{service: service}
}

// GetWorld returns safe public world data by share slug.
// @Summary Get public universe
// @Tags share
// @Produce json
// @Param shareSlug path string true "Share slug"
// @Success 200 {object} models.PublicWorldResponse
// @Failure 404 {object} httpx.ErrorEnvelope
// @Failure 500 {object} httpx.ErrorEnvelope
// @Router /share/worlds/{shareSlug} [get]
func (h *ShareHandler) GetWorld(w http.ResponseWriter, r *http.Request) {
	response, err := h.service.GetPublicWorld(r.Context(), chi.URLParam(r, "shareSlug"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}
