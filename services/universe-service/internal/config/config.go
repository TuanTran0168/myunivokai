package config

import (
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv             string
	AppName            string
	PublicWebURL       string
	PublicAPIURL       string
	APIHost            string
	APIPort            string
	AllowedOrigins     []string
	DatabaseURL        string
	DatabaseDirectURL  string
	// Pool sizing. Neon's pooler prefers short-lived connections, so the
	// lifetime defaults stay conservative.
	DatabaseMaxConns        int
	DatabaseMinConns        int
	DatabaseMaxConnLifetime time.Duration
	DatabaseMaxConnIdleTime time.Duration
	AIProvider         string
	AIFallbackProvider string
	AIEnableFallback   bool
	AITimeout          time.Duration
	AIMaxRetries       int
	AIPromptVersion    string
	GeminiAPIKey       string
	GeminiModel        string
	OpenAIAPIKey       string
	OpenAIModel        string
	RateLimitRPS       float64
	RateLimitBurst     int
	// TrustProxyHeaders declares that a trusted reverse proxy (Render, a load
	// balancer) sits in front of the API and appends the real client address
	// to X-Forwarded-For. Only then may rate limiting key on that header.
	TrustProxyHeaders bool
	ShareSlugLength   int
}

func Load() Config {
	LoadEnv()
	return Config{
		AppEnv:             getAny([]string{"APP_ENV", "ENV"}, "development"),
		AppName:            get("APP_NAME", "Myunivokai"),
		PublicWebURL:       get("PUBLIC_WEB_URL", "http://localhost:3000"),
		PublicAPIURL:       get("PUBLIC_API_URL", "http://localhost:8080"),
		APIHost: get("API_HOST", "0.0.0.0"),
		// API_PORT wins locally; PORT is the platform-injected port on
		// Render/Heroku-style hosts, so an unconfigured deploy still binds
		// where the platform routes traffic.
		APIPort: getAny([]string{"API_PORT", "PORT"}, "8080"),
		AllowedOrigins:     split(get("API_ALLOWED_ORIGINS", "http://localhost:3000")),
		DatabaseURL:        get("DATABASE_URL", ""),
		DatabaseDirectURL:  get("DATABASE_DIRECT_URL", ""),
		DatabaseMaxConns:        getInt("DATABASE_MAX_CONNS", 10),
		DatabaseMinConns:        getInt("DATABASE_MIN_CONNS", 0),
		DatabaseMaxConnLifetime: getDuration("DATABASE_MAX_CONN_LIFETIME", 30*time.Minute),
		DatabaseMaxConnIdleTime: getDuration("DATABASE_MAX_CONN_IDLE_TIME", 5*time.Minute),
		AIProvider:         get("AI_PROVIDER", "mock"),
		AIFallbackProvider: get("AI_FALLBACK_PROVIDER", "mock"),
		AIEnableFallback:   getBool("AI_ENABLE_FALLBACK", true),
		AITimeout:          time.Duration(getInt("AI_TIMEOUT_SECONDS", 35)) * time.Second,
		AIMaxRetries:       getInt("AI_MAX_RETRIES", 2),
		AIPromptVersion:    get("AI_PROMPT_VERSION", "world-dna-v1"),
		GeminiAPIKey:       get("GEMINI_API_KEY", ""),
		GeminiModel:        get("GEMINI_MODEL", "gemini-2.5-flash"),
		OpenAIAPIKey:       get("OPENAI_API_KEY", ""),
		OpenAIModel:        get("OPENAI_MODEL", "gpt-4.1-mini"),
		RateLimitRPS: getFloat("RATE_LIMIT_RPS", 2),
		// Burst must comfortably exceed one screen's legitimate fan-out (the
		// gallery burst); 20 keeps abuse protection while never starving a
		// single user's page load.
		RateLimitBurst:    getInt("RATE_LIMIT_BURST", 20),
		TrustProxyHeaders: getBool("TRUST_PROXY", false),
		ShareSlugLength:   getInt("SHARE_SLUG_LENGTH", 10),
	}
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

// IsProduction reports whether the app runs with a production APP_ENV; shared
// by the Swagger gate and the prod-only startup guards.
func (c Config) IsProduction() bool {
	normalized := strings.ToLower(strings.TrimSpace(c.AppEnv))
	return normalized == "production" || normalized == "prod"
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

func getFloat(key string, fallback float64) float64 {
	value, err := strconv.ParseFloat(get(key, ""), 64)
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

func split(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
