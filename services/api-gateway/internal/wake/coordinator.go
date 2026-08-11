package wake

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// seenWriteInterval is how stale the liveness stamp is allowed to get. It is
// deliberately coarse against the fifteen minutes of idleness a host waits
// before spinning an instance down: a sleep interval derived to the minute is
// as useful as one derived to the second, and the second costs a Redis write
// on every request.
const seenWriteInterval = time.Minute

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

// StatsRecorder is where the two things worth knowing about a scale-to-zero
// fleet are written: how often each service actually had to be started, and
// when each was last known to be running.
//
// Optional in the same way SingleFlightLock is - a nil recorder turns both
// off without affecting a single wake. Measurement must never be able to
// break the thing it measures.
type StatsRecorder interface {
	IncrementWakeCount(ctx context.Context, service string, at time.Time) error
	RecordServiceSeen(ctx context.Context, service string, at time.Time) error
}

// Coordinator wraps a Platform with the policy every platform needs, the way
// ai.Orchestrator wraps ai.Provider with timeout, budget and repair. Nothing
// below is vendor-specific, which is precisely why it does not live in the
// adapters.
type Coordinator struct {
	platform       Platform
	lock           SingleFlightLock
	stats          StatsRecorder
	wakeTimeout    time.Duration
	lockTimeToLive time.Duration
	retryAfter     time.Duration

	// seenMutex guards lastSeenWritten, which throttles the liveness stamp.
	// Seen is called on every successful reply, so without this a busy
	// gateway would add a Redis round trip to each one to rewrite a value
	// that only needs minute resolution. See Seen.
	seenMutex       sync.Mutex
	lastSeenWritten map[string]time.Time
}

func NewCoordinator(platform Platform, lock SingleFlightLock, stats StatsRecorder, wakeTimeout, lockTimeToLive, retryAfter time.Duration) *Coordinator {
	return &Coordinator{
		platform:        platform,
		lock:            lock,
		stats:           stats,
		wakeTimeout:     wakeTimeout,
		lockTimeToLive:  lockTimeToLive,
		retryAfter:      retryAfter,
		lastSeenWritten: make(map[string]time.Time),
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
	// Counted here, at the decision to call, rather than after the call
	// returns. The error below explicitly does not mean the wake failed - a
	// host that starts an instance on connect has already started it - so
	// counting successes would undercount exactly the slow cold starts worth
	// knowing about.
	coordinator.recordWake(ctx, service)
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

// Seen records that a service answered, which is the only unbiased way to
// know it was awake.
//
// Called on every successful reply, so it is throttled: the value it writes
// needs minute resolution to bound a fifteen-minute idle timeout, and adding
// a Redis round trip to every request to rewrite it more precisely than that
// would be paying on the hot path for a digit nobody reads. At most one write
// per service per seenWriteInterval, whatever the traffic.
//
// A failed write is dropped without a log line. This is the request path, the
// value is a dashboard timestamp, and a Redis blip must not turn a working
// query into noise in the operator's logs.
func (coordinator *Coordinator) Seen(service string) {
	if coordinator == nil || coordinator.stats == nil || service == "" {
		return
	}
	now := time.Now()
	if !coordinator.claimSeenWrite(service, now) {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), coordinator.wakeTimeout)
		defer cancel()
		_ = coordinator.stats.RecordServiceSeen(ctx, service, now)
	}()
}

// claimSeenWrite reports whether enough time has passed to write again, and
// records the attempt if so. The stamp moves on the attempt rather than on
// the successful write, so a Redis outage cannot turn every subsequent
// request into a retry storm against a store that is already struggling.
func (coordinator *Coordinator) claimSeenWrite(service string, now time.Time) bool {
	coordinator.seenMutex.Lock()
	defer coordinator.seenMutex.Unlock()
	if lastWritten, found := coordinator.lastSeenWritten[service]; found && now.Sub(lastWritten) < seenWriteInterval {
		return false
	}
	if coordinator.lastSeenWritten == nil {
		coordinator.lastSeenWritten = make(map[string]time.Time)
	}
	coordinator.lastSeenWritten[service] = now
	return true
}

// recordWake is fire-and-forget for the same reason the wake itself is: the
// caller is a detached goroutine on a deadline, and a statistic that cannot
// be written is not a reason to skip starting a service.
func (coordinator *Coordinator) recordWake(ctx context.Context, service string) {
	if coordinator.stats == nil {
		return
	}
	if err := coordinator.stats.IncrementWakeCount(ctx, service, time.Now()); err != nil {
		log.Warn().Err(err).Str("service", service).Msg("record wake count")
	}
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
