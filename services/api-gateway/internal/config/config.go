package config

import (
	"crypto/ed25519"
	"encoding/base64"
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
	// A handful of staff, not the public internet, but each admin page load
	// fans out several analytics queries at once (S4-ANALYTICS-004) rather
	// than one request at a time, so this needs a higher ceiling than the
	// product default it used to copy verbatim.
	defaultAdminRateLimitRequestsPerSecond = 10
	defaultAdminRateLimitBurst             = 50
	// Matches auth-service's own AUTH_TOKEN_VERSION_CACHE_TTL default - the
	// two writers (auth-service on bump, the gateway on cache-miss fallback)
	// don't need to agree exactly, but starting from the same number is the
	// sane default until real usage says otherwise.
	defaultAdminTokenVersionCacheTTL = 15 * 24 * time.Hour
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
	// AdminRoutesEnabled gates the whole /api/admin sub-router. Default false:
	// a fresh deploy of this binary must not crash-loop the product edge over
	// admin-only vars nobody has filled in yet, and the switch itself exists
	// so the admin surface can be taken offline without redeploying — see
	// notes/vision/auth-and-admin-plan.md#amended--one-gateway-two-route-groups.
	AdminRoutesEnabled              bool
	AdminAllowedOrigin              string
	AdminRateLimitRequestsPerSecond float64
	AdminRateLimitBurst             int
	// AdminAccessPublicKeys holds every currently-accepted Ed25519 public key
	// for verifying the admin access token locally (RequireAdminAccessToken) -
	// never the private key, which only auth-service ever holds. More than
	// one during a rotation drill: add the new key before removing the old
	// one so no session is force-logged-out - see
	// notes/vision/auth-and-admin-plan.md#tokens.
	AdminAccessPublicKeys     []ed25519.PublicKey
	AdminTokenVersionCacheTTL time.Duration
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

		AdminRoutesEnabled:              getBool("ADMIN_ROUTES_ENABLED", false),
		AdminAllowedOrigin:              get("ADMIN_ALLOWED_ORIGIN", ""),
		AdminRateLimitRequestsPerSecond: getFloat("ADMIN_RATE_LIMIT_REQUESTS_PER_SECOND", defaultAdminRateLimitRequestsPerSecond),
		AdminRateLimitBurst:             getInt("ADMIN_RATE_LIMIT_BURST", defaultAdminRateLimitBurst),
		AdminTokenVersionCacheTTL:       getDuration("ADMIN_TOKEN_VERSION_CACHE_TTL", defaultAdminTokenVersionCacheTTL),
	}
	adminAccessPublicKeys, err := decodeEd25519PublicKeys(get("ADMIN_ACCESS_PUBLIC_KEYS", ""))
	if err != nil {
		return Config{}, err
	}
	loadedConfig.AdminAccessPublicKeys = adminAccessPublicKeys
	if err := loadedConfig.Validate(); err != nil {
		return Config{}, err
	}
	return loadedConfig, nil
}

// decodeEd25519PublicKeys parses a comma-separated list of base64-standard-
// encoded 32-byte Ed25519 public keys - plural so a key-rotation drill can
// list both the new and the outgoing key at once (TokenVerifier accepts
// either until the old one is removed).
func decodeEd25519PublicKeys(commaSeparated string) ([]ed25519.PublicKey, error) {
	trimmed := strings.TrimSpace(commaSeparated)
	if trimmed == "" {
		return nil, nil
	}
	encodedKeys := strings.Split(trimmed, ",")
	publicKeys := make([]ed25519.PublicKey, 0, len(encodedKeys))
	for _, encodedKey := range encodedKeys {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encodedKey))
		if err != nil {
			return nil, errors.New("ADMIN_ACCESS_PUBLIC_KEYS must be base64-encoded")
		}
		if len(decoded) != ed25519.PublicKeySize {
			return nil, errors.New("ADMIN_ACCESS_PUBLIC_KEYS must decode to 32-byte Ed25519 public keys")
		}
		publicKeys = append(publicKeys, ed25519.PublicKey(decoded))
	}
	return publicKeys, nil
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
			if err := validateOriginFormat(origin); err != nil {
				return err
			}
		}
	}
	if loadedConfig.AdminRoutesEnabled {
		// No wildcard is acceptable here at any point, dev included — the
		// admin origin check is unconditional, unlike the product group's
		// (which only tightens in production) — see
		// notes/vision/auth-and-admin-plan.md#amended--one-gateway-two-route-groups.
		if err := validateOriginFormat(loadedConfig.AdminAllowedOrigin); err != nil {
			return fmt.Errorf("ADMIN_ALLOWED_ORIGIN: %w", err)
		}
		if loadedConfig.AdminRateLimitRequestsPerSecond <= 0 || loadedConfig.AdminRateLimitBurst <= 0 {
			return errors.New("admin rate limit values must be positive")
		}
		if len(loadedConfig.AdminAccessPublicKeys) == 0 {
			return errors.New("ADMIN_ACCESS_PUBLIC_KEYS is required when ADMIN_ROUTES_ENABLED is true")
		}
		if loadedConfig.AdminTokenVersionCacheTTL <= 0 {
			return errors.New("ADMIN_TOKEN_VERSION_CACHE_TTL must be positive")
		}
	}
	return nil
}

func (loadedConfig Config) Address() string {
	return loadedConfig.APIHost + ":" + loadedConfig.APIPort
}

// IsProduction reports whether cookies and other environment-sensitive
// behavior should use their hardened form (e.g. the admin session cookies'
// Secure attribute) rather than the dev-friendly default.
func (loadedConfig Config) IsProduction() bool {
	return loadedConfig.isProduction()
}

func (loadedConfig Config) isProduction() bool {
	normalizedEnvironment := strings.ToLower(strings.TrimSpace(loadedConfig.AppEnvironment))
	return normalizedEnvironment == "production" || normalizedEnvironment == "prod"
}

func validateOriginFormat(origin string) error {
	if strings.Contains(origin, "*") {
		return errors.New("wildcard CORS origins are not allowed")
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
