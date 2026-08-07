package repositories

import (
	"context"
	"errors"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/models"
)

// ErrMalformedCursor is returned rather than silently restarting from page
// one, so a client that corrupts a cursor learns about it instead of quietly
// re-reading rows it already showed.
var ErrMalformedCursor = errors.New("malformed cursor")

// Store is deliberately asymmetric: exactly one write method, and it is only
// ever called by the event consumer. Every other method reads. That asymmetry
// is the design rule of this service — see
// notes/vision/analytics-service-plan.md#what-this-service-is-in-one-sentence.
type Store interface {
	// Apply writes one event's inbox row and its projection in a single
	// transaction, and reports whether the message was new. A false means
	// the message had already been processed and nothing was written.
	Apply(ctx context.Context, projection models.Projection) (applied bool, err error)

	Overview(ctx context.Context, filter models.OverviewFilter) (contracts.AnalyticsOverviewResponseData, error)
	ListWorlds(ctx context.Context, filter models.WorldListFilter) (contracts.AnalyticsWorldListResponseData, error)
	ListJobs(ctx context.Context, filter models.JobListFilter) (contracts.AnalyticsJobListResponseData, error)
	Timeseries(ctx context.Context, filter models.OverviewFilter) (contracts.AnalyticsTimeseriesResponseData, error)

	// Ping reports whether the backing storage is reachable.
	Ping(ctx context.Context) error
}
