package proxy

import (
	"testing"
	"time"
)

func TestCircuitBreakerOpensAndAllowsOneHalfOpenProbe(t *testing.T) {
	now := time.Now()
	breaker := NewCircuitBreaker(2, time.Minute)
	breaker.now = func() time.Time { return now }
	breaker.RecordFailure()
	if !breaker.Allow() {
		t.Fatal("breaker opened before threshold")
	}
	breaker.RecordFailure()
	if breaker.Allow() {
		t.Fatal("breaker remained closed at threshold")
	}
	now = now.Add(time.Minute)
	if !breaker.Allow() {
		t.Fatal("breaker did not allow half-open probe")
	}
	if breaker.Allow() {
		t.Fatal("breaker allowed more than one half-open probe")
	}
	breaker.RecordSuccess()
	if !breaker.Allow() {
		t.Fatal("successful probe did not close breaker")
	}
}
