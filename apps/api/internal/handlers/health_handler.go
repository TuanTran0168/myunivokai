package handlers

import (
	"net/http"
	"time"

	"github.com/myunivokai/myunivokai/apps/api/internal/config"
	"github.com/myunivokai/myunivokai/apps/api/internal/httpx"
)

type HealthHandler struct {
	cfg config.Config
}

func NewHealthHandler(cfg config.Config) *HealthHandler {
	return &HealthHandler{cfg: cfg}
}

// Handle returns API health.
// @Summary Health check
// @Tags health
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /healthz [get]
func (h *HealthHandler) Handle(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"app":       h.cfg.AppName,
		"env":       h.cfg.AppEnv,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}
