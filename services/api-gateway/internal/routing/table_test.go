package routing

import (
	"net/http"
	"testing"
	"time"
)

func TestPolicyForUsesRouteSpecificTimeouts(t *testing.T) {
	timeouts := Timeouts{Standard: time.Second, CreateWorld: 2 * time.Second, Share: 3 * time.Second}
	if policy := PolicyFor(http.MethodPost, "/worlds", timeouts); policy.Timeout != timeouts.CreateWorld {
		t.Fatalf("create timeout = %s, want %s", policy.Timeout, timeouts.CreateWorld)
	}
	if policy := PolicyFor(http.MethodGet, "/share/worlds/example", timeouts); policy.Timeout != timeouts.Share || !policy.CacheShare {
		t.Fatalf("share policy = %+v", policy)
	}
	if policy := PolicyFor(http.MethodGet, "/worlds", timeouts); policy.Timeout != timeouts.Standard {
		t.Fatalf("standard timeout = %s, want %s", policy.Timeout, timeouts.Standard)
	}
}
