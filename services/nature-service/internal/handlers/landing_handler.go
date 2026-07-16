package handlers

import (
	"net/http"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/config"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/httpx"
)

// LandingHandler answers the bare service URL with a small JSON welcome (the
// HTML landing page stays a universe-service feature; this service is
// API-only until the frontend rounds).
type LandingHandler struct {
	cfg config.Config
}

func NewLandingHandler(cfg config.Config) *LandingHandler {
	return &LandingHandler{cfg: cfg}
}

func (h *LandingHandler) Handle(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"service": h.cfg.AppName,
		"status":  "ok",
		"api":     "/api/v1",
		"health":  "/api/v1/healthz",
	})
}
