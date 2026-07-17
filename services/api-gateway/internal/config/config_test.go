package config

import (
	"net/url"
	"strings"
	"testing"
)

func TestProductionValidationRequiresGatewaySecurity(t *testing.T) {
	universeURL, _ := url.Parse("https://universe.example.com")
	natureURL, _ := url.Parse("https://nature.example.com")
	config := validTestConfig()
	config.AppEnv = "production"
	config.UniverseServiceURL = universeURL
	config.NatureServiceURL = natureURL
	config.TrustProxyHeaders = true
	config.GatewaySharedSecret = strings.Repeat("s", defaultGatewaySharedSecretMinLength)
	if err := config.Validate(); err != nil {
		t.Fatalf("valid production config rejected: %v", err)
	}

	config.GatewaySharedSecret = "short"
	if err := config.Validate(); err == nil {
		t.Fatal("expected short production secret to be rejected")
	}
}

func TestParseServiceURLRejectsCredentials(t *testing.T) {
	if _, err := parseServiceURL("UPSTREAM", "https://user:secret@example.com"); err == nil {
		t.Fatal("expected URL credentials to be rejected")
	}
}

func TestProductionValidationRejectsWildcardAndPathOrigins(t *testing.T) {
	universeURL, _ := url.Parse("https://universe.example.com")
	natureURL, _ := url.Parse("https://nature.example.com")
	config := validTestConfig()
	config.AppEnv = "production"
	config.UniverseServiceURL = universeURL
	config.NatureServiceURL = natureURL
	config.TrustProxyHeaders = true
	config.GatewaySharedSecret = strings.Repeat("s", defaultGatewaySharedSecretMinLength)

	config.AllowedOrigins = []string{"https://*.example.com"}
	if err := config.Validate(); err == nil {
		t.Fatal("expected wildcard origin to be rejected")
	}
	config.AllowedOrigins = []string{"https://web.example.com/path"}
	if err := config.Validate(); err == nil {
		t.Fatal("expected origin path to be rejected")
	}
}

func validTestConfig() Config {
	universeURL, _ := url.Parse("http://universe.example.com")
	natureURL, _ := url.Parse("http://nature.example.com")
	return Config{
		AppEnv:                     "test",
		AllowedOrigins:             []string{"http://localhost:3000"},
		UniverseServiceURL:         universeURL,
		NatureServiceURL:           natureURL,
		RateLimitRequestsPerSecond: 10,
		RateLimitBurst:             20,
		MaximumRequestBodyBytes:    64 * 1024,
		StandardProxyTimeout:       1,
		CreateWorldProxyTimeout:    1,
		ShareProxyTimeout:          1,
		StatusCheckTimeout:         1,
		ShareCacheMaximumEntries:   10,
		CircuitBreakerFailureLimit: 3,
		CircuitBreakerCooldown:     1,
	}
}
