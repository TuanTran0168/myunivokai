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
	defaultAPIPort                    = "8080"
	defaultMaximumRequestBodyBytes    = 64 * 1024
	defaultRateLimitRequestsPerSecond = 2
	defaultRateLimitBurst             = 20
	defaultNATSPublishTimeout         = 5 * time.Second
	defaultNATSRequestTimeout         = 3 * time.Second
	defaultNATSConnectTimeout         = 5 * time.Second
	defaultNATSReconnectWait          = 2 * time.Second
	defaultJobCacheTimeToLive         = 30 * time.Second
	defaultWorldCacheTimeToLive       = 60 * time.Second
	defaultShareCacheTimeToLive       = 60 * time.Second
	defaultShutdownTimeout            = 15 * time.Second
	defaultRedisKeyPrefix             = "myunivokai"
)

type Config struct {
	AppEnvironment             string
	AppName                    string
	APIHost                    string
	APIPort                    string
	AllowedOrigins             []string
	TrustProxyHeaders          bool
	MaximumRequestBodyBytes    int64
	RateLimitRequestsPerSecond float64
	RateLimitBurst             int
	NATSURL                    string
	NATSUsername               string
	NATSPassword               string
	NATSCredentialsFile        string
	NATSPublishTimeout         time.Duration
	NATSRequestTimeout         time.Duration
	NATSConnectTimeout         time.Duration
	NATSReconnectWait          time.Duration
	RedisURL                   string
	RedisKeyPrefix             string
	JobCacheTimeToLive         time.Duration
	WorldCacheTimeToLive       time.Duration
	ShareCacheTimeToLive       time.Duration
	ShutdownTimeout            time.Duration
}

func Load() (Config, error) {
	loadEnvironmentFiles()
	loadedConfig := Config{
		AppEnvironment:             get("APP_ENV", "development"),
		AppName:                    get("APP_NAME", "Myunivokai API Gateway"),
		APIHost:                    get("API_HOST", "0.0.0.0"),
		APIPort:                    getAny([]string{"API_PORT", "PORT"}, defaultAPIPort),
		AllowedOrigins:             split(get("API_ALLOWED_ORIGINS", "http://localhost:41300")),
		TrustProxyHeaders:          getBool("TRUST_PROXY", false),
		MaximumRequestBodyBytes:    getInt64("MAX_REQUEST_BODY_BYTES", defaultMaximumRequestBodyBytes),
		RateLimitRequestsPerSecond: getFloat("RATE_LIMIT_REQUESTS_PER_SECOND", defaultRateLimitRequestsPerSecond),
		RateLimitBurst:             getInt("RATE_LIMIT_BURST", defaultRateLimitBurst),
		NATSURL:                    get("NATS_URL", "nats://localhost:4222"),
		NATSUsername:               get("NATS_USERNAME", ""),
		NATSPassword:               get("NATS_PASSWORD", ""),
		NATSCredentialsFile:        get("NATS_CREDENTIALS", ""),
		NATSPublishTimeout:         getDuration("NATS_PUBLISH_TIMEOUT", defaultNATSPublishTimeout),
		NATSRequestTimeout:         getDuration("NATS_REQUEST_TIMEOUT", defaultNATSRequestTimeout),
		NATSConnectTimeout:         getDuration("NATS_CONNECT_TIMEOUT", defaultNATSConnectTimeout),
		NATSReconnectWait:          getDuration("NATS_RECONNECT_WAIT", defaultNATSReconnectWait),
		RedisURL:                   get("REDIS_URL", "redis://localhost:6379/0"),
		RedisKeyPrefix:             get("REDIS_KEY_PREFIX", defaultRedisKeyPrefix),
		JobCacheTimeToLive:         getDuration("JOB_CACHE_TTL", defaultJobCacheTimeToLive),
		WorldCacheTimeToLive:       getDuration("WORLD_CACHE_TTL", defaultWorldCacheTimeToLive),
		ShareCacheTimeToLive:       getDuration("SHARE_CACHE_TTL", defaultShareCacheTimeToLive),
		ShutdownTimeout:            getDuration("SERVICE_SHUTDOWN_TIMEOUT", defaultShutdownTimeout),
	}
	if err := loadedConfig.Validate(); err != nil {
		return Config{}, err
	}
	return loadedConfig, nil
}

func (loadedConfig Config) Validate() error {
	if len(loadedConfig.AllowedOrigins) == 0 {
		return errors.New("API_ALLOWED_ORIGINS must contain at least one origin")
	}
	if strings.TrimSpace(loadedConfig.NATSURL) == "" || strings.TrimSpace(loadedConfig.RedisURL) == "" {
		return errors.New("NATS_URL and REDIS_URL are required")
	}
	if loadedConfig.MaximumRequestBodyBytes <= 0 || loadedConfig.RateLimitRequestsPerSecond <= 0 || loadedConfig.RateLimitBurst <= 0 {
		return errors.New("request body and rate limit values must be positive")
	}
	if loadedConfig.NATSPublishTimeout <= 0 || loadedConfig.NATSRequestTimeout <= 0 || loadedConfig.NATSConnectTimeout <= 0 || loadedConfig.NATSReconnectWait <= 0 || loadedConfig.ShutdownTimeout <= 0 {
		return errors.New("NATS and shutdown timeouts must be positive")
	}
	if loadedConfig.JobCacheTimeToLive <= 0 || loadedConfig.WorldCacheTimeToLive <= 0 || loadedConfig.ShareCacheTimeToLive <= 0 {
		return errors.New("cache TTL values must be positive")
	}
	if strings.TrimSpace(loadedConfig.RedisKeyPrefix) == "" {
		return errors.New("REDIS_KEY_PREFIX is required")
	}
	if loadedConfig.isProduction() {
		if !loadedConfig.TrustProxyHeaders {
			return errors.New("TRUST_PROXY must be true in production")
		}
		for _, origin := range loadedConfig.AllowedOrigins {
			if err := validateProductionOrigin(origin); err != nil {
				return err
			}
		}
	}
	return nil
}

func (loadedConfig Config) Address() string {
	return loadedConfig.APIHost + ":" + loadedConfig.APIPort
}

func (loadedConfig Config) isProduction() bool {
	normalizedEnvironment := strings.ToLower(strings.TrimSpace(loadedConfig.AppEnvironment))
	return normalizedEnvironment == "production" || normalizedEnvironment == "prod"
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

func loadEnvironmentFiles() {
	originalEnvironment := snapshotEnvironment()
	explicitFile := strings.TrimSpace(os.Getenv("MYUNIVOKAI_ENV_FILE"))
	if explicitFile != "" {
		_ = godotenv.Overload(explicitFile)
		restoreEnvironment(originalEnvironment)
		return
	}
	_ = godotenv.Overload(".env", ".env.local")
	restoreEnvironment(originalEnvironment)
}

func snapshotEnvironment() map[string]string {
	values := make(map[string]string)
	for _, pair := range os.Environ() {
		key, value, found := strings.Cut(pair, "=")
		if found {
			values[key] = value
		}
	}
	return values
}

func restoreEnvironment(values map[string]string) {
	for key, value := range values {
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
		if trimmedPart := strings.TrimSpace(part); trimmedPart != "" {
			values = append(values, trimmedPart)
		}
	}
	return values
}
