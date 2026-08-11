package wake

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
)

// SingleFlightLock keeps a burst of requests against one sleeping service
// from producing a burst of wake calls. It is noise control, not correctness:
// a duplicate wake is harmless, so a lock backend that is down must never
// stop a wake from happening.
//
// The gateway's Redis store implements this; a nil lock disables deduplication
// without disabling the wake, which is what unit tests use.
type SingleFlightLock interface {
	AcquireWakeLock(ctx context.Context, service string, timeToLive time.Duration) (bool, error)
}

// Coordinator wraps a Platform with the policy every platform needs, the way
// ai.Orchestrator wraps ai.Provider with timeout, budget and repair. Nothing
// below is vendor-specific, which is precisely why it does not live in the
// adapters.
type Coordinator struct {
	platform       Platform
	lock           SingleFlightLock
	wakeTimeout    time.Duration
	lockTimeToLive time.Duration
	retryAfter     time.Duration
}

func NewCoordinator(platform Platform, lock SingleFlightLock, wakeTimeout, lockTimeToLive, retryAfter time.Duration) *Coordinator {
	return &Coordinator{
		platform:       platform,
		lock:           lock,
		wakeTimeout:    wakeTimeout,
		lockTimeToLive: lockTimeToLive,
		retryAfter:     retryAfter,
	}
}

// Supports reports whether a wake for this service would actually do
// something. A nil Coordinator answers false, so the gateway can hold one
// unconditionally and skip a branch at every call site.
func (coordinator *Coordinator) Supports(service string) bool {
	if coordinator == nil || coordinator.platform == nil || service == "" {
		return false
	}
	return coordinator.platform.Supports(service)
}

// PlatformName reports which adapter was selected, for startup logging. A nil
// Coordinator answers PlatformNone, which is what it behaves as.
func (coordinator *Coordinator) PlatformName() PlatformName {
	if coordinator == nil || coordinator.platform == nil {
		return PlatformNone
	}
	return coordinator.platform.Name()
}

// WakeableServices lists the services this process can actually start, in the
// fixed order of Services.
//
// It exists because "configured" and "effective" drift apart here, and only
// the second one matters. A deploy can name a platform, pass validation and
// still reach nobody - the http adapter with no URLs yet is exactly that. A
// gateway that reports what it intended rather than what it can do is how the
// wake mechanism would fail silently, which is the failure it was written to
// remove.
func (coordinator *Coordinator) WakeableServices() []string {
	wakeable := make([]string, 0, len(Services))
	for _, service := range Services {
		if coordinator.Supports(service) {
			wakeable = append(wakeable, service)
		}
	}
	return wakeable
}

// RetryAfter is how long a client should wait before retrying a request that
// hit a sleeping service. It is a cold-start estimate, not a promise.
func (coordinator *Coordinator) RetryAfter() time.Duration {
	if coordinator == nil {
		return 0
	}
	return coordinator.retryAfter
}

// Wake starts the service and returns immediately, without reporting whether
// anything worked.
//
// It takes no context on purpose. The only context in scope at every call
// site is the HTTP request's, and that is cancelled the moment the response
// is written — passing it in would cancel the very wake it was fired for.
// Making the parameter absent removes the chance to get that wrong.
//
// Nor may the gateway wait for the result. A cold start runs 20-60 seconds
// while this server's WriteTimeout is roughly 8 (cmd/gateway/main.go), so the
// response would be cut off before the service was reachable; and the gateway
// is itself a scale-to-zero instance, so holding connections open for a minute
// each turns one sleeping service into a second outage. Answer fast, tell the
// client when to come back, let its retry land after the wake.
func (coordinator *Coordinator) Wake(service string) {
	if !coordinator.Supports(service) {
		return
	}
	go coordinator.wakeDetached(service)
}

func (coordinator *Coordinator) wakeDetached(service string) {
	ctx, cancel := context.WithTimeout(context.Background(), coordinator.wakeTimeout)
	defer cancel()
	if !coordinator.claim(ctx, service) {
		return
	}
	if err := coordinator.platform.Wake(ctx, service); err != nil {
		// Expected, and not an error worth alarming on: a host that starts an
		// instance when a connection arrives has already begun doing so, and
		// the boot outlasts any timeout worth holding a goroutine for. The
		// wake still happened; only our observation of it timed out.
		log.Debug().Err(err).Str("service", service).Str("wake_platform", string(coordinator.platform.Name())).Msg("wake call did not complete")
		return
	}
	log.Info().Str("service", service).Str("wake_platform", string(coordinator.platform.Name())).Msg("wake call sent")
}

// claim reports whether this goroutine is the one that should wake the
// service. A lock error deliberately returns true: losing a wake costs a
// stalled page, losing deduplication costs one redundant HTTP call.
func (coordinator *Coordinator) claim(ctx context.Context, service string) bool {
	if coordinator.lock == nil || coordinator.lockTimeToLive <= 0 {
		return true
	}
	acquired, err := coordinator.lock.AcquireWakeLock(ctx, service, coordinator.lockTimeToLive)
	if err != nil {
		log.Warn().Err(err).Str("service", service).Msg("acquire wake single-flight lock")
		return true
	}
	return acquired
}
