package config

import (
	"testing"
	"time"
)

func TestProductionValidationRequiresTrustedProxyAndExactOrigins(t *testing.T) {
	serviceConfig := validTestConfig()
	serviceConfig.AppEnvironment = "production"
	serviceConfig.TrustProxyHeaders = true
	serviceConfig.AllowedOrigins = []string{"https://web.example.com"}
	if err := serviceConfig.Validate(); err != nil {
		t.Fatalf("valid production config rejected: %v", err)
	}

	serviceConfig.TrustProxyHeaders = false
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected untrusted production proxy configuration to be rejected")
	}
	serviceConfig.TrustProxyHeaders = true
	serviceConfig.AllowedOrigins = []string{"https://*.example.com"}
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected wildcard origin to be rejected")
	}
	serviceConfig.AllowedOrigins = []string{"https://web.example.com/path"}
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected origin path to be rejected")
	}
}

func TestValidationRequiresPositiveOperationalLimits(t *testing.T) {
	serviceConfig := validTestConfig()
	serviceConfig.NATSRequestTimeout = 0
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected zero NATS request timeout to be rejected")
	}

	serviceConfig = validTestConfig()
	serviceConfig.WorldCacheTimeToLive = 0
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected zero world cache TTL to be rejected")
	}
}

func validTestConfig() Config {
	return Config{
		AppEnvironment:             "test",
		AllowedOrigins:             []string{"http://localhost:3000"},
		MaximumRequestBodyBytes:    64 * 1024,
		RateLimitRequestsPerSecond: 10,
		RateLimitBurst:             20,
		NATSURL:                    "nats://localhost:4222",
		NATSPublishTimeout:         time.Second,
		NATSRequestTimeout:         time.Second,
		RedisURL:                   "redis://localhost:6379/0",
		RedisKeyPrefix:             "test",
		JobCacheTimeToLive:         time.Minute,
		WorldCacheTimeToLive:       time.Minute,
		ShareCacheTimeToLive:       time.Minute,
		ShutdownTimeout:            time.Second,
	}
}
