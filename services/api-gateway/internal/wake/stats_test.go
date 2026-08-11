package wake

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeStatsRecorder struct {
	wakes      chan string
	seen       chan string
	recordFail error
}

func newFakeStatsRecorder() *fakeStatsRecorder {
	return &fakeStatsRecorder{wakes: make(chan string, 8), seen: make(chan string, 8)}
}

func (recorder *fakeStatsRecorder) IncrementWakeCount(_ context.Context, service string, _ time.Time) error {
	recorder.wakes <- service
	return recorder.recordFail
}

func (recorder *fakeStatsRecorder) RecordServiceSeen(_ context.Context, service string, _ time.Time) error {
	recorder.seen <- service
	return recorder.recordFail
}

func waitForRecord(t *testing.T, channel chan string, what string) string {
	t.Helper()
	select {
	case service := <-channel:
		return service
	case <-time.After(2 * time.Second):
		t.Fatalf("expected a %s record but none arrived", what)
		return ""
	}
}

func assertNoRecord(t *testing.T, channel chan string, what string) {
	t.Helper()
	select {
	case service := <-channel:
		t.Fatalf("expected no %s record, but got one for %q", what, service)
	case <-time.After(quietWindow):
	}
}

// The counter has to sit behind the single-flight lock, not in front of it.
// In front, it would count requests that found a service asleep; behind, it
// counts calls actually sent - and only the calls cost instance-hours, which
// is the entire reason for measuring.
func TestOnlyTheWakeThatWinsTheLockIsCounted(t *testing.T) {
	recorder := newFakeStatsRecorder()
	platform := newFakePlatform(ServiceDNA)
	granted := NewCoordinator(platform, newFakeLock(true, nil), recorder, time.Second, time.Minute, time.Second)
	granted.Wake(ServiceDNA)
	if service := waitForRecord(t, recorder.wakes, "wake"); service != ServiceDNA {
		t.Fatalf("counted %q, want %q", service, ServiceDNA)
	}

	suppressed := NewCoordinator(platform, newFakeLock(false, nil), recorder, time.Second, time.Minute, time.Second)
	suppressed.Wake(ServiceDNA)
	assertNoRecord(t, recorder.wakes, "wake")
}

// A service that cannot be woken is never woken, so it must never be counted
// either - otherwise the statistic reports work the gateway did not do.
func TestAnUnsupportedServiceIsNeverCounted(t *testing.T) {
	recorder := newFakeStatsRecorder()
	coordinator := NewCoordinator(newFakePlatform(ServiceDNA), newFakeLock(true, nil), recorder, time.Second, time.Minute, time.Second)
	coordinator.Wake(ServiceAuth)
	assertNoRecord(t, recorder.wakes, "wake")
}

// Seen runs on every successful reply, so the write is throttled. Without
// this, a busy gateway would add a Redis round trip to each request in order
// to rewrite a timestamp that only needs minute resolution.
func TestSeenIsWrittenOncePerIntervalNoMatterTheTraffic(t *testing.T) {
	recorder := newFakeStatsRecorder()
	coordinator := NewCoordinator(newFakePlatform(), nil, recorder, time.Second, time.Minute, time.Second)
	for range 25 {
		coordinator.Seen(ServiceUniverse)
	}
	if service := waitForRecord(t, recorder.seen, "seen"); service != ServiceUniverse {
		t.Fatalf("recorded %q, want %q", service, ServiceUniverse)
	}
	assertNoRecord(t, recorder.seen, "seen")
}

// The throttle is per service. One busy family must not hide the liveness of
// another, because the whole point of the stamp is to bound how long each
// individual service was asleep.
func TestTheSeenThrottleIsPerService(t *testing.T) {
	recorder := newFakeStatsRecorder()
	coordinator := NewCoordinator(newFakePlatform(), nil, recorder, time.Second, time.Minute, time.Second)
	coordinator.Seen(ServiceUniverse)
	coordinator.Seen(ServiceNature)
	recorded := map[string]bool{
		waitForRecord(t, recorder.seen, "seen"): true,
		waitForRecord(t, recorder.seen, "seen"): true,
	}
	if !recorded[ServiceUniverse] || !recorded[ServiceNature] {
		t.Fatalf("both services should have been stamped, got %v", recorded)
	}
}

// Measurement must not be able to break the thing it measures. A recorder
// that errors, and a coordinator with no recorder at all, both have to leave
// the wake itself untouched.
func TestStatisticsNeverInterfereWithTheWake(t *testing.T) {
	failing := newFakeStatsRecorder()
	failing.recordFail = errors.New("redis is down")
	platform := newFakePlatform(ServiceDNA)
	coordinator := NewCoordinator(platform, newFakeLock(true, nil), failing, time.Second, time.Minute, time.Second)
	coordinator.Wake(ServiceDNA)
	if service := waitForWake(t, platform); service != ServiceDNA {
		t.Fatalf("woke %q, want %q", service, ServiceDNA)
	}

	withoutRecorder := newFakePlatform(ServiceDNA)
	NewCoordinator(withoutRecorder, newFakeLock(true, nil), nil, time.Second, time.Minute, time.Second).Wake(ServiceDNA)
	if service := waitForWake(t, withoutRecorder); service != ServiceDNA {
		t.Fatalf("woke %q, want %q", service, ServiceDNA)
	}
}

// A nil Coordinator is inert everywhere else, and Seen is called from the
// request path, so it has to be inert here too rather than panicking a
// perfectly good query.
func TestSeenOnANilCoordinatorDoesNothing(t *testing.T) {
	var coordinator *Coordinator
	coordinator.Seen(ServiceDNA)
	coordinator.Seen("")
}
