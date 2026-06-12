package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/config"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/httpx"
)

const readinessCheckTimeout = 3 * time.Second

// ReadinessChecker reports whether a dependency is ready to serve traffic.
type ReadinessChecker interface {
	Ping(ctx context.Context) error
}

type HealthHandler struct {
	cfg   config.Config
	store ReadinessChecker
}

func NewHealthHandler(cfg config.Config, store ReadinessChecker) *HealthHandler {
	return &HealthHandler{cfg: cfg, store: store}
}

// Handle returns liveness: the process is up. It must not touch dependencies,
// so the platform never restarts the API just because the database blipped.
// @Summary Health check (liveness)
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

// HandleReadiness returns readiness: dependencies are reachable. Deploy
// platforms should route traffic only when this returns 200.
// @Summary Readiness check (dependencies)
// @Tags health
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Failure 503 {object} map[string]interface{}
// @Router /readyz [get]
func (h *HealthHandler) HandleReadiness(w http.ResponseWriter, r *http.Request) {
	checkCtx, cancel := context.WithTimeout(r.Context(), readinessCheckTimeout)
	defer cancel()
	if err := h.store.Ping(checkCtx); err != nil {
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":    false,
			"store": "unreachable",
		})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"store": "ready",
	})
}
