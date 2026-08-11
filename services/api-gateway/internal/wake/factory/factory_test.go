package factory

import (
	"strings"
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
)

func wakeConfig(platform string, targets map[string]string) config.Config {
	return config.Config{
		ServiceWakePlatform:       platform,
		ServiceWakeTargets:        targets,
		ServiceWakeTimeout:        5 * time.Second,
		ServiceWakeLockTimeToLive: time.Minute,
		ServiceWakeRetryAfter:     15 * time.Second,
	}
}

func TestTheDefaultPlatformSupportsNothing(t *testing.T) {
	coordinator, err := NewCoordinator(wakeConfig(string(wake.PlatformNone), nil), nil)
	if err != nil {
		t.Fatalf("the none platform should always build: %v", err)
	}
	for _, service := range wake.Services {
		if coordinator.Supports(service) {
			t.Fatalf("the none platform supports %q; it must reach nobody", service)
		}
	}
}

func TestTheHTTPPlatformSupportsOnlyTheServicesGivenAURL(t *testing.T) {
	coordinator, err := NewCoordinator(wakeConfig(string(wake.PlatformHTTP), map[string]string{
		wake.ServiceAuth:      "https://myunivokai-auth.onrender.com",
		wake.ServiceAnalytics: "https://myunivokai-analytics.onrender.com",
	}), nil)
	if err != nil {
		t.Fatalf("NewCoordinator returned %v", err)
	}
	for _, service := range []string{wake.ServiceAuth, wake.ServiceAnalytics} {
		if !coordinator.Supports(service) {
			t.Fatalf("%q was given a URL but is not supported", service)
		}
	}
	// dna/universe/nature were left unconfigured on purpose: a partly filled
	// deployment must not claim it can wake what it cannot reach, because the
	// gateway turns that claim into a SERVICE_WAKING the client retries on.
	for _, service := range []string{wake.ServiceDNA, wake.ServiceUniverse, wake.ServiceNature} {
		if coordinator.Supports(service) {
			t.Fatalf("%q has no URL but reported as supported", service)
		}
	}
}

// A typo must stop the deploy. Falling back to "none" would produce a gateway
// that silently never wakes anything and reports plain 503s for months.
func TestAnUnknownPlatformNameFails(t *testing.T) {
	if _, err := NewCoordinator(wakeConfig("renderr", nil), nil); err == nil {
		t.Fatal("an unknown SERVICE_WAKE_PLATFORM was accepted")
	}
}

// Selecting the HTTP platform and supplying no URL is not a working
// configuration; it is a deploy that believes it has wake coverage and has
// none.
func TestTheHTTPPlatformRequiresAtLeastOneURL(t *testing.T) {
	_, err := NewCoordinator(wakeConfig(string(wake.PlatformHTTP), nil), nil)
	if err == nil {
		t.Fatal("the http platform was accepted with no service URLs")
	}
	if !strings.Contains(err.Error(), "SERVICE_WAKE_PLATFORM") {
		t.Fatalf("the error should name the variable an operator has to fix, got %q", err)
	}
}

func TestRetryAfterComesFromConfiguration(t *testing.T) {
	serviceConfig := wakeConfig(string(wake.PlatformNone), nil)
	serviceConfig.ServiceWakeRetryAfter = 20 * time.Second
	coordinator, err := NewCoordinator(serviceConfig, nil)
	if err != nil {
		t.Fatalf("NewCoordinator returned %v", err)
	}
	if retryAfter := coordinator.RetryAfter(); retryAfter != 20*time.Second {
		t.Fatalf("RetryAfter() = %s, want 20s", retryAfter)
	}
}
