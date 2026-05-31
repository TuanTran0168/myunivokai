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
	ShareSlugLength    int
}

func Load() Config {
	LoadEnv()
	return Config{
		AppEnv:             getAny([]string{"APP_ENV", "ENV"}, "development"),
		AppName:            get("APP_NAME", "Myunivokai"),
		PublicWebURL:       get("PUBLIC_WEB_URL", "http://localhost:3000"),
		PublicAPIURL:       get("PUBLIC_API_URL", "http://localhost:8080"),
		APIHost:            get("API_HOST", "0.0.0.0"),
		APIPort:            get("API_PORT", "8080"),
		AllowedOrigins:     split(get("API_ALLOWED_ORIGINS", "http://localhost:3000")),
		DatabaseURL:        get("DATABASE_URL", ""),
		DatabaseDirectURL:  get("DATABASE_DIRECT_URL", ""),
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
		RateLimitRPS:       getFloat("RATE_LIMIT_RPS", 2),
		RateLimitBurst:     getInt("RATE_LIMIT_BURST", 8),
		ShareSlugLength:    getInt("SHARE_SLUG_LENGTH", 10),
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
