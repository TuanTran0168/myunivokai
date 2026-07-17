package routing

import (
	"net/http"
	"strings"
	"time"
)

const (
	UniversePrefix    = "/api/universe"
	NaturePrefix      = "/api/nature"
	UpstreamAPIPrefix = "/api/v1"
)

type Timeouts struct {
	Standard    time.Duration
	CreateWorld time.Duration
	Share       time.Duration
}

type Policy struct {
	Timeout    time.Duration
	CacheShare bool
}

func PolicyFor(method, relativePath string, timeouts Timeouts) Policy {
	if method == http.MethodPost && relativePath == "/worlds" {
		return Policy{Timeout: timeouts.CreateWorld}
	}
	if method == http.MethodGet && strings.HasPrefix(relativePath, "/share/") {
		return Policy{Timeout: timeouts.Share, CacheShare: true}
	}
	return Policy{Timeout: timeouts.Standard}
}
