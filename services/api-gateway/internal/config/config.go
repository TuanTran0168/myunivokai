package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

const (
	defaultAPIPort                      = "8082"
	defaultGatewaySharedSecretMinLength = 32
)

type Config struct {
	AppEnv                     string
	AppName                    string
	APIHost                    string
	APIPort                    string
	AllowedOrigins             []string
	UniverseServiceURL         *url.URL
	NatureServiceURL           *url.URL
	GatewaySharedSecret        string
	RateLimitRequestsPerSecond float64
	RateLimitBurst             int
	TrustProxyHeaders          bool
	MaximumRequestBodyBytes    int64
	StandardProxyTimeout       time.Duration
	CreateWorldProxyTimeout    time.Duration
	ShareProxyTimeout          time.Duration
	StatusCheckTimeout         time.Duration
	ShareCacheTTL              time.Duration
	ShareCacheMaximumEntries   int
	CircuitBreakerFailureLimit int
	CircuitBreakerCooldown     time.Duration
	ShutdownTimeout            time.Duration
}

func Load() (Config, error) {
	loadEnv()
	universeServiceURL, universeError := parseServiceURL("UNIVERSE_SERVICE_URL", get("UNIVERSE_SERVICE_URL", "http://localhost:8080"))
	natureServiceURL, natureError := parseServiceURL("NATURE_SERVICE_URL", get("NATURE_SERVICE_URL", "http://localhost:8081"))
	config := Config{
		AppEnv:                     getAny([]string{"APP_ENV", "ENV"}, "development"),
		AppName:                    get("APP_NAME", "Myunivokai API Gateway"),
		APIHost:                    get("API_HOST", "0.0.0.0"),
		APIPort:                    getAny([]string{"API_PORT", "PORT"}, defaultAPIPort),
		AllowedOrigins:             split(get("API_ALLOWED_ORIGINS", "http://localhost:3000")),
		UniverseServiceURL:         universeServiceURL,
		NatureServiceURL:           natureServiceURL,
		GatewaySharedSecret:        strings.TrimSpace(os.Getenv("GATEWAY_SHARED_SECRET")),
		RateLimitRequestsPerSecond: getFloat("RATE_LIMIT_RPS", 2),
		RateLimitBurst:             getInt("RATE_LIMIT_BURST", 20),
		TrustProxyHeaders:          getBool("TRUST_PROXY", false),
		MaximumRequestBodyBytes:    getInt64("MAX_REQUEST_BODY_BYTES", 64*1024),
		StandardProxyTimeout:       getDuration("PROXY_TIMEOUT", 15*time.Second),
		CreateWorldProxyTimeout:    getDuration("CREATE_WORLD_TIMEOUT", 120*time.Second),
		ShareProxyTimeout:          getDuration("SHARE_TIMEOUT", 5*time.Second),
		StatusCheckTimeout:         getDuration("STATUS_TIMEOUT", 5*time.Second),
		ShareCacheTTL:              getDuration("SHARE_CACHE_TTL", 60*time.Second),
		ShareCacheMaximumEntries:   getInt("SHARE_CACHE_MAX_ENTRIES", 1000),
		CircuitBreakerFailureLimit: getInt("CIRCUIT_BREAKER_FAILURE_THRESHOLD", 3),
		CircuitBreakerCooldown:     getDuration("CIRCUIT_BREAKER_COOLDOWN", 30*time.Second),
		ShutdownTimeout:            getDuration("SHUTDOWN_TIMEOUT", 10*time.Second),
	}
	if universeError != nil {
		return Config{}, universeError
	}
	if natureError != nil {
		return Config{}, natureError
	}
	if err := config.Validate(); err != nil {
		return Config{}, err
	}
	return config, nil
}

func (config Config) Validate() error {
	if config.UniverseServiceURL == nil || config.NatureServiceURL == nil {
		return errors.New("both upstream service URLs are required")
	}
	if config.RateLimitRequestsPerSecond <= 0 || config.RateLimitBurst <= 0 {
		return errors.New("rate limit values must be positive")
	}
	if config.MaximumRequestBodyBytes <= 0 {
		return errors.New("MAX_REQUEST_BODY_BYTES must be positive")
	}
	if config.StandardProxyTimeout <= 0 || config.CreateWorldProxyTimeout <= 0 || config.ShareProxyTimeout <= 0 || config.StatusCheckTimeout <= 0 {
		return errors.New("proxy and status timeouts must be positive")
	}
	if config.ShareCacheTTL < 0 || config.ShareCacheMaximumEntries <= 0 || config.CircuitBreakerCooldown <= 0 || config.CircuitBreakerFailureLimit <= 0 {
		return errors.New("cache and circuit breaker values are invalid")
	}
	if len(config.AllowedOrigins) == 0 {
		return errors.New("API_ALLOWED_ORIGINS must contain at least one origin")
	}
	if config.IsProduction() {
		if len(config.GatewaySharedSecret) < defaultGatewaySharedSecretMinLength {
			return fmt.Errorf("GATEWAY_SHARED_SECRET must contain at least %d characters in production", defaultGatewaySharedSecretMinLength)
		}
		if !config.TrustProxyHeaders {
			return errors.New("TRUST_PROXY must be true in production behind the Render proxy")
		}
		if config.UniverseServiceURL.Scheme != "https" || config.NatureServiceURL.Scheme != "https" {
			return errors.New("upstream service URLs must use https in production")
		}
		for _, origin := range config.AllowedOrigins {
			if err := validateProductionOrigin(origin); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateProductionOrigin(origin string) error {
	if strings.Contains(origin, "*") {
		return errors.New("wildcard CORS origins are not allowed in production")
	}
	parsedOrigin, err := url.Parse(origin)
	if err != nil || parsedOrigin.Host == "" || (parsedOrigin.Scheme != "http" && parsedOrigin.Scheme != "https") {
		return fmt.Errorf("CORS origin %q must be an absolute http or https origin", origin)
	}
	if parsedOrigin.User != nil || parsedOrigin.Path != "" || parsedOrigin.RawQuery != "" || parsedOrigin.Fragment != "" {
		return fmt.Errorf("CORS origin %q must not contain credentials, a path, query, or fragment", origin)
	}
	return nil
}

func (config Config) Addr() string {
	return config.APIHost + ":" + config.APIPort
}

func (config Config) IsProduction() bool {
	normalized := strings.ToLower(strings.TrimSpace(config.AppEnv))
	return normalized == "production" || normalized == "prod"
}

func parseServiceURL(key, value string) (*url.URL, error) {
	parsedURL, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return nil, fmt.Errorf("%s must be an absolute http or https URL", key)
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return nil, fmt.Errorf("%s must use http or https", key)
	}
	if parsedURL.User != nil || parsedURL.RawQuery != "" || parsedURL.Fragment != "" {
		return nil, fmt.Errorf("%s must not contain credentials, a query, or a fragment", key)
	}
	parsedURL.Path = strings.TrimRight(parsedURL.Path, "/")
	return parsedURL, nil
}

func loadEnv() {
	original := snapshotEnv()
	explicit := strings.TrimSpace(os.Getenv("MYUNIVOKAI_ENV_FILE"))
	if explicit != "" {
		loadEnvFiles(original, explicit)
		return
	}
	files := []string{".env", ".env.local"}
	appEnvironment := strings.TrimSpace(os.Getenv("APP_ENV"))
	if appEnvironment == "" {
		appEnvironment = strings.TrimSpace(os.Getenv("ENV"))
	}
	for _, name := range envAliases(appEnvironment) {
		files = append(files, ".env."+name, ".env."+name+".local")
	}
	loadEnvFiles(original, files...)
}

func envAliases(appEnvironment string) []string {
	switch strings.ToLower(strings.TrimSpace(appEnvironment)) {
	case "production", "prod":
		return []string{"prod", "production"}
	case "development", "dev", "":
		return []string{"dev", "development"}
	case "test":
		return []string{"test"}
	default:
		return []string{strings.ToLower(strings.TrimSpace(appEnvironment))}
	}
}

func snapshotEnv() map[string]string {
	values := map[string]string{}
	for _, pair := range os.Environ() {
		key, value, found := strings.Cut(pair, "=")
		if found {
			values[key] = value
		}
	}
	return values
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

func getInt64(key string, fallback int64) int64 {
	value, err := strconv.ParseInt(get(key, ""), 10, 64)
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

func split(value string) []string {
	parts := strings.Split(value, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			values = append(values, trimmed)
		}
	}
	return values
}
