// Package config mirrors universe-service's config loader, trimmed to what
// nature-service needs today: no real AI provider keys until the real-AI
// round. DATABASE_URL must point to nature-service's OWN logical database —
// a second database inside the same Neon project as universe-service (zero
// extra cost), never the universe database itself.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv              string
	AppName             string
	PublicWebURL        string
	PublicAPIURL        string
	APIHost             string
	APIPort             string
	GatewaySharedSecret string
	DatabaseURL         string
	DatabaseDirectURL   string
	// Pool sizing. Neon's pooler prefers short-lived connections, so the
	// lifetime defaults stay conservative — and the compute endpoint is shared
	// with universe-service (same Neon project), so stay modest.
	DatabaseMaxConns        int
	DatabaseMinConns        int
	DatabaseMaxConnLifetime time.Duration
	DatabaseMaxConnIdleTime time.Duration
	AIProvider              string
	AIFallbackProvider      string
	AIEnableFallback        bool
	AITimeout               time.Duration
	// AITotalBudget caps one whole DNA generation (all repair retries and the
	// fallback provider combined); AITimeout caps each individual call.
	AITotalBudget   time.Duration
	AIMaxRetries    int
	AIPromptVersion string
	ShareSlugLength int
}

// defaultAITotalBudgetMultiplier derives the whole-generation budget from the
// per-call timeout when AI_TOTAL_BUDGET is unset: enough for a primary call, a
// repair retry, and the fallback, while staying under the server write timeout.
const defaultAITotalBudgetMultiplier = 3
const minimumGatewaySharedSecretLength = 32

// defaultAPIPort deliberately differs from universe-service's 8080 so both
// services can run side by side on one developer machine.
const defaultAPIPort = "8081"

func Load() Config {
	LoadEnv()
	cfg := Config{
		AppEnv:       getAny([]string{"APP_ENV", "ENV"}, "development"),
		AppName:      get("APP_NAME", "Myunivokai Nature"),
		PublicWebURL: get("PUBLIC_WEB_URL", "http://localhost:3000"),
		PublicAPIURL: get("PUBLIC_API_URL", "http://localhost:"+defaultAPIPort),
		APIHost:      get("API_HOST", "0.0.0.0"),
		// API_PORT wins locally; PORT is the platform-injected port on
		// Render/Heroku-style hosts, so an unconfigured deploy still binds
		// where the platform routes traffic.
		APIPort:                 getAny([]string{"API_PORT", "PORT"}, defaultAPIPort),
		GatewaySharedSecret:     strings.TrimSpace(os.Getenv("GATEWAY_SHARED_SECRET")),
		DatabaseURL:             get("DATABASE_URL", ""),
		DatabaseDirectURL:       get("DATABASE_DIRECT_URL", ""),
		DatabaseMaxConns:        getInt("DATABASE_MAX_CONNS", 10),
		DatabaseMinConns:        getInt("DATABASE_MIN_CONNS", 0),
		DatabaseMaxConnLifetime: getDuration("DATABASE_MAX_CONN_LIFETIME", 30*time.Minute),
		DatabaseMaxConnIdleTime: getDuration("DATABASE_MAX_CONN_IDLE_TIME", 5*time.Minute),
		AIProvider:              get("AI_PROVIDER", "mock"),
		AIFallbackProvider:      get("AI_FALLBACK_PROVIDER", "mock"),
		AIEnableFallback:        getBool("AI_ENABLE_FALLBACK", true),
		AITimeout:               time.Duration(getInt("AI_TIMEOUT_SECONDS", 35)) * time.Second,
		// 0 means "derive from AI_TIMEOUT_SECONDS"; resolved right below so
		// every consumer (orchestrator, server write timeout) sees one value.
		AITotalBudget:   getDuration("AI_TOTAL_BUDGET", 0),
		AIMaxRetries:    getInt("AI_MAX_RETRIES", 2),
		AIPromptVersion: get("AI_PROMPT_VERSION", "forest-dna-v1"),
		ShareSlugLength: getInt("SHARE_SLUG_LENGTH", 10),
	}
	if cfg.AITotalBudget <= 0 {
		cfg.AITotalBudget = defaultAITotalBudgetMultiplier * cfg.AITimeout
	}
	return cfg
}

func LoadEnv() {
	original := snapshotEnv()
	explicit := strings.TrimSpace(os.Getenv("MYUNIVOKAI_ENV_FILE"))
	if explicit != "" {
		loadEnvFiles(original, explicit)
		return
	}

	files := []string{".env", ".env.local"}
	appEnv := strings.TrimSpace(os.Getenv("APP_ENV"))
	if appEnv == "" {
		appEnv = strings.TrimSpace(os.Getenv("ENV"))
	}
	for _, name := range envAliases(appEnv) {
		files = append(files, ".env."+name, ".env."+name+".local")
	}
	loadEnvFiles(original, files...)
}

func (c Config) Addr() string {
	return c.APIHost + ":" + c.APIPort
}

// IsProduction reports whether the app runs with a production APP_ENV; used by
// the prod-only startup guards (no in-memory store in production).
func (c Config) IsProduction() bool {
	normalized := strings.ToLower(strings.TrimSpace(c.AppEnv))
	return normalized == "production" || normalized == "prod"
}

// ValidateProductionGatewayAccess prevents a public production service from
// starting with business routes that callers could use to bypass the gateway.
func (c Config) ValidateProductionGatewayAccess() error {
	if c.IsProduction() && len(c.GatewaySharedSecret) < minimumGatewaySharedSecretLength {
		return fmt.Errorf("GATEWAY_SHARED_SECRET must contain at least %d characters in production", minimumGatewaySharedSecretLength)
	}
	return nil
}

func envAliases(appEnv string) []string {
	switch strings.ToLower(strings.TrimSpace(appEnv)) {
	case "production", "prod":
		return []string{"prod", "production"}
	case "development", "dev", "":
		return []string{"dev", "development"}
	case "test":
		return []string{"test"}
	default:
		return []string{strings.ToLower(strings.TrimSpace(appEnv))}
	}
}

func snapshotEnv() map[string]string {
	out := map[string]string{}
	for _, pair := range os.Environ() {
		key, value, ok := strings.Cut(pair, "=")
		if ok {
			out[key] = value
		}
	}
	return out
}

func loadEnvFiles(original map[string]string, files ...string) {
	for _, file := range files {
		_ = godotenv.Overload(file)
	}
	for key, value := range original {
		_ = os.Setenv(key, value)
	}
}

func get(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func getAny(keys []string, fallback string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return fallback
}

func getInt(key string, fallback int) int {
	value, err := strconv.Atoi(get(key, ""))
	if err != nil {
		return fallback
	}
	return value
}

// getDuration parses Go duration strings such as "30m" or "90s".
func getDuration(key string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(get(key, ""))
	if err != nil {
		return fallback
	}
	return value
}

func getBool(key string, fallback bool) bool {
	value := strings.ToLower(get(key, ""))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes"
}
