package handlers

import (
	"net/http"
	"time"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/config"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/web"
	"github.com/rs/zerolog/log"
)

// LandingHandler serves a small human-friendly page at the service root, so
// visiting the bare API URL greets people instead of returning a JSON 404.
type LandingHandler struct {
	cfg             config.Config
	serverStartTime time.Time
}

func NewLandingHandler(cfg config.Config, serverStartTime time.Time) *LandingHandler {
	return &LandingHandler{cfg: cfg, serverStartTime: serverStartTime}
}

type landingPageData struct {
	AppName                     string
	Environment                 string
	PublicWebURL                string
	ServerStartUnixMilliseconds int64
}

func (h *LandingHandler) Handle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	pageData := landingPageData{
		AppName:                     h.cfg.AppName,
		Environment:                 h.cfg.AppEnv,
		PublicWebURL:                h.cfg.PublicWebURL,
		ServerStartUnixMilliseconds: h.serverStartTime.UnixMilli(),
	}
	if err := web.LandingPageTemplate.Execute(w, pageData); err != nil {
		log.Error().Err(err).Msg("render landing page")
	}
}
