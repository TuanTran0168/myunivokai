// Package factory turns the configured platform name into a wake
// coordinator, and is the only place that knows which adapter goes with which
// name — the same job services/dna-service/internal/aifactory does for AI
// providers, kept in its own package for the same reason: config must not
// import the adapters, and the adapters must not import config.
package factory

import (
	"fmt"
	"net/http"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake/platforms"
)

// NewCoordinator fails on an unknown platform name rather than falling back to
// "none". A typo in SERVICE_WAKE_PLATFORM should stop the deploy, not quietly
// produce a gateway that never wakes anything and reports plain 503s months
// later.
func NewCoordinator(serviceConfig config.Config, lock wake.SingleFlightLock) (*wake.Coordinator, error) {
	platform, err := newPlatform(serviceConfig.ServiceWakePlatform, serviceConfig)
	if err != nil {
		return nil, err
	}
	return wake.NewCoordinator(
		platform,
		lock,
		serviceConfig.ServiceWakeTimeout,
		serviceConfig.ServiceWakeLockTimeToLive,
		serviceConfig.ServiceWakeRetryAfter,
	), nil
}

func newPlatform(platformName string, serviceConfig config.Config) (wake.Platform, error) {
	switch wake.PlatformName(platformName) {
	case wake.PlatformNone:
		return platforms.NewNone(), nil
	case wake.PlatformHTTP:
		// Which configuration a platform needs is the platform's business,
		// which is why this check lives here and not in config.Validate: a
		// future adapter that scales a Deployment through an orchestrator API
		// would need credentials and no URLs at all.
		if len(serviceConfig.ServiceWakeTargets) == 0 {
			return nil, fmt.Errorf("SERVICE_WAKE_PLATFORM=%q requires at least one service URL (DNA_SERVICE_URL, UNIVERSE_SERVICE_URL, NATURE_SERVICE_URL, AUTH_SERVICE_URL, ANALYTICS_SERVICE_URL)", wake.PlatformHTTP)
		}
		return platforms.NewHTTP(serviceConfig.ServiceWakeTargets, &http.Client{Timeout: serviceConfig.ServiceWakeTimeout}), nil
	default:
		return nil, fmt.Errorf("unsupported service wake platform %q", platformName)
	}
}
