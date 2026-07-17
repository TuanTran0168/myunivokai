package proxy

import (
	"sync"
	"time"
)

type CircuitBreaker struct {
	failureThreshold    int
	cooldown            time.Duration
	mutex               sync.Mutex
	consecutiveFailures int
	openedAt            time.Time
	halfOpenProbe       bool
	now                 func() time.Time
}

func NewCircuitBreaker(failureThreshold int, cooldown time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		failureThreshold: failureThreshold,
		cooldown:         cooldown,
		now:              time.Now,
	}
}

func (breaker *CircuitBreaker) Allow() bool {
	breaker.mutex.Lock()
	defer breaker.mutex.Unlock()
	if breaker.openedAt.IsZero() {
		return true
	}
	if breaker.now().Sub(breaker.openedAt) < breaker.cooldown || breaker.halfOpenProbe {
		return false
	}
	breaker.halfOpenProbe = true
	return true
}

func (breaker *CircuitBreaker) RecordSuccess() {
	breaker.mutex.Lock()
	defer breaker.mutex.Unlock()
	breaker.consecutiveFailures = 0
	breaker.openedAt = time.Time{}
	breaker.halfOpenProbe = false
}

func (breaker *CircuitBreaker) RecordFailure() {
	breaker.mutex.Lock()
	defer breaker.mutex.Unlock()
	breaker.consecutiveFailures++
	if breaker.halfOpenProbe || breaker.consecutiveFailures >= breaker.failureThreshold {
		breaker.openedAt = breaker.now()
		breaker.halfOpenProbe = false
	}
}

func (breaker *CircuitBreaker) RetryAfter() time.Duration {
	breaker.mutex.Lock()
	defer breaker.mutex.Unlock()
	if breaker.openedAt.IsZero() {
		return 0
	}
	remaining := breaker.cooldown - breaker.now().Sub(breaker.openedAt)
	if remaining < 0 {
		return 0
	}
	return remaining
}
