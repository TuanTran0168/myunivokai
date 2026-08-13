package contracts

import (
	"fmt"
	"time"
)

const (
	// UniverseWorldChangedEventSubject and NatureWorldChangedEventSubject
	// carry a WorldSnapshot after every mutation that is not the world's
	// creation. Creation itself carries its snapshot on the existing
	// completed event, so analytics has exactly one projection function
	// rather than two — see
	// notes/vision/analytics-service-plan.md#design-decision-snapshot-events-not-fine-grained-events.
	//
	// Neither subject needed a stream or ACL change: MYUNIVOKAI_EVENTS
	// already filters on "myunivokai.events.>", and both family services
	// already publish "myunivokai.events.<family>.>" as a wildcard.
	UniverseWorldChangedEventSubject = "myunivokai.events.universe.world.changed.v1"
	NatureWorldChangedEventSubject   = "myunivokai.events.nature.world.changed.v1"

	// The analytics query subjects need no gateway ACL change either —
	// the gateway may already publish "myunivokai.queries.>".
	AnalyticsOverviewGetQuerySubject   = "myunivokai.queries.analytics.overview.get.v1"
	AnalyticsWorldListQuerySubject     = "myunivokai.queries.analytics.world.list.v1"
	AnalyticsWorldGetQuerySubject      = "myunivokai.queries.analytics.world.get.v1"
	AnalyticsJobListQuerySubject       = "myunivokai.queries.analytics.job.list.v1"
	AnalyticsTimeseriesGetQuerySubject = "myunivokai.queries.analytics.timeseries.get.v1"

	// Pagination and range bounds are declared here rather than inside
	// analytics-service because the gateway relays raw query strings and the
	// admin app builds them: all three need the same numbers to agree on
	// what a page is. The upper bound exists because the request/reply
	// deadline is 2500ms and an unbounded table will eventually exceed it.
	AnalyticsDefaultPageSize = 25
	AnalyticsMaximumPageSize = 100
	AnalyticsDefaultDays     = 30
	AnalyticsMaximumDays     = 90
)

// WorldChangedEventSubject mirrors CompletedEventSubject and
// FailedEventSubject so callers switch on the family in one place.
func (family WorldFamily) WorldChangedEventSubject() (string, error) {
	switch family {
	case WorldFamilyUniverse:
		return UniverseWorldChangedEventSubject, nil
	case WorldFamilyNature:
		return NatureWorldChangedEventSubject, nil
	default:
		return "", fmt.Errorf("unsupported world family %q", family)
	}
}

// WorldSnapshot is the analytics data boundary, written as an allow list
// rather than a deny list: this struct IS the complete set of fields that may
// ever be copied out of a family database into the analytics database.
// Nothing may be added without a matching line in
// notes/vision/analytics-service-plan.md#data-boundary.
//
// Nickname is the only user-entered value here, kept deliberately so an admin
// table has a human label; raw_input, profile_dna, dna_snapshot, quote,
// variant config and share slugs never cross under any phase.
//
// Revision is what makes the projection safe under JetStream's duplicate and
// out-of-order delivery: the reader upserts only when the incoming revision
// exceeds the stored one, which comparing wall-clock timestamps from two
// different services could never do correctly.
type WorldSnapshot struct {
	WorldID           string      `json:"worldId"`
	Family            WorldFamily `json:"family"`
	ProfileID         string      `json:"profileId"`
	DNAVersionID      string      `json:"dnaVersionId"`
	SourceJobID       string      `json:"sourceJobId"`
	Revision          int         `json:"revision"`
	Nickname          string      `json:"nickname"`
	Role              string      `json:"role,omitempty"`
	Archetype         string      `json:"archetype"`
	SceneName         string      `json:"sceneName"`
	Mood              string      `json:"mood"`
	WorldStyle        string      `json:"worldStyle"`
	FavoriteColors    []string    `json:"favoriteColors"`
	TraitScores       TraitScores `json:"traitScores"`
	VariantCount      int         `json:"variantCount"`
	SelectedVariantNo int         `json:"selectedVariantNo"`
	PublishedAt       *time.Time  `json:"publishedAt,omitempty"`
	WorldCreatedAt    time.Time   `json:"worldCreatedAt"`
}

// FamilyWorldChangedData carries a snapshot and nothing else. Every later
// state of a world arrives on this shape; the first one arrives on
// FamilyCompletedData.Snapshot.
type FamilyWorldChangedData struct {
	Snapshot WorldSnapshot `json:"snapshot"`
}

// AnalyticsFamilyTotals is one family's row in the overview. Counts are
// computed in SQL inside analytics-service; the gateway sums nothing.
type AnalyticsFamilyTotals struct {
	Family         WorldFamily `json:"family"`
	WorldCount     int         `json:"worldCount"`
	PublishedCount int         `json:"publishedCount"`
	VariantCount   int         `json:"variantCount"`
	JobCount       int         `json:"jobCount"`
	FailedJobCount int         `json:"failedJobCount"`
}

// AnalyticsDistributionSlice is one bar of a distribution chart. Value is a
// column value (an archetype, a world style, a mood, an error code), never a
// free-text label built at the edge.
type AnalyticsDistributionSlice struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

// AnalyticsJobHealth answers "are jobs succeeding, and how fast" in one
// shape. Durations come from envelope timestamps recorded at projection
// time, never from a clock inside analytics-service.
type AnalyticsJobHealth struct {
	TotalJobs          int     `json:"totalJobs"`
	CompletedJobs      int     `json:"completedJobs"`
	FailedJobs         int     `json:"failedJobs"`
	InFlightJobs       int     `json:"inFlightJobs"`
	FailureRatePercent float64 `json:"failureRatePercent"`
	AverageDurationMs  int     `json:"averageDurationMs"`
	// P50 is the duration a person actually experiences; P95 is the one that
	// decides the timeout. Reporting only one of them has repeatedly meant
	// tuning for a tail that a handful of jobs own, or shipping a median that
	// hides an unusable tail — so both travel together everywhere.
	//
	// Unlike telemetry-service's, these two are exact: analytics-service has
	// every job's own duration_ms and computes PERCENTILE_CONT over it,
	// rather than interpolating across fixed histogram edges.
	P50DurationMs       int     `json:"p50DurationMs"`
	P95DurationMs       int     `json:"p95DurationMs"`
	SlowestDurationMs   int     `json:"slowestDurationMs"`
	MeasuredJobCount    int     `json:"measuredJobCount"`
	PublishRatePercent  float64 `json:"publishRatePercent"`
	MultiVariantPercent float64 `json:"multiVariantPercent"`
}

// AnalyticsDelta compares one measure against the equivalent window before it
// — the "vs yesterday" the dashboard cards carry.
//
// The absolute values ride along with the percentage because a percentage
// alone is unreadable at low volume: +200% is three worlds becoming nine, and
// the reader has no way to know that from the percentage.
type AnalyticsDelta struct {
	Current       int     `json:"current"`
	Previous      int     `json:"previous"`
	ChangePercent float64 `json:"changePercent"`
	// HasBaseline is false when the preceding window has no data at all,
	// which is different from a previous value of zero. A platform that was
	// deployed yesterday has no baseline, and rendering "+100%" against
	// nothing invents a trend.
	HasBaseline bool `json:"hasBaseline"`
}

// AnalyticsComparison is one period measured against the one before it. The
// period is a day: "today vs yesterday" is the comparison an operator actually
// makes, and it is the shortest one that is not mostly noise.
type AnalyticsComparison struct {
	// PeriodHours is how wide each side of the comparison is, stated rather
	// than assumed so the card can label itself instead of hard-coding "24h".
	PeriodHours     int            `json:"periodHours"`
	Worlds          AnalyticsDelta `json:"worlds"`
	PublishedWorlds AnalyticsDelta `json:"publishedWorlds"`
	Jobs            AnalyticsDelta `json:"jobs"`
	FailedJobs      AnalyticsDelta `json:"failedJobs"`
}

// The generation funnel's stages. Stable machine keys — the admin app orders
// and colours by these, so a renamed label must not become a new stage.
const (
	AnalyticsFunnelStageSubmitted = "submitted"
	AnalyticsFunnelStageCompleted = "completed"
	AnalyticsFunnelStageProjected = "projected"
	AnalyticsFunnelStagePublished = "published"
)

// AnalyticsFunnelStage is one step of the generation funnel: a job was
// submitted, it finished, a world came out of it, and somebody published that
// world. Each stage is a strict subset of the one before it, which is what
// makes the shape a funnel rather than four unrelated counters.
//
// PercentOfEntry is against the FIRST stage, not the previous one, so the
// whole funnel reads end to end without multiplying percentages in your head.
type AnalyticsFunnelStage struct {
	Stage          string  `json:"stage"`
	Label          string  `json:"label"`
	Count          int     `json:"count"`
	PercentOfEntry float64 `json:"percentOfEntry"`
}

// AnalyticsHourBucket is one hour of the day summed across every day in the
// window — "when is the generator reliably busy", which the day-by-day
// timeline cannot answer.
type AnalyticsHourBucket struct {
	// Hour is 0-23 UTC. The admin app labels the timezone rather than
	// converting, so two operators in two countries read the same number.
	Hour     int `json:"hour"`
	JobCount int `json:"jobCount"`
}

// AnalyticsOverviewQueryData scopes the dashboard. An empty Family means
// every family; Days bounds the job-health and distribution windows and is
// clamped to AnalyticsMaximumDays by the service.
type AnalyticsOverviewQueryData struct {
	Family WorldFamily `json:"family,omitempty"`
	Days   int         `json:"days,omitempty"`
}

type AnalyticsOverviewResponseData struct {
	Days                 int                          `json:"days"`
	TotalWorlds          int                          `json:"totalWorlds"`
	TotalPublished       int                          `json:"totalPublished"`
	WorldsInWindow       int                          `json:"worldsInWindow"`
	Families             []AnalyticsFamilyTotals      `json:"families"`
	JobHealth            AnalyticsJobHealth           `json:"jobHealth"`
	ArchetypeTop         []AnalyticsDistributionSlice `json:"archetypeTop"`
	WorldStyleTop        []AnalyticsDistributionSlice `json:"worldStyleTop"`
	MoodTop              []AnalyticsDistributionSlice `json:"moodTop"`
	ErrorCodeTop         []AnalyticsDistributionSlice `json:"errorCodeTop"`
	AverageTraitScores   TraitScores                  `json:"averageTraitScores"`
	GeneratedAt          time.Time                    `json:"generatedAt"`
	OldestProjectedWorld *time.Time                   `json:"oldestProjectedWorld,omitempty"`
	// Comparison is always present and always spans one day on each side,
	// independent of Days above: the range picker scopes the distributions
	// and the funnel, while "vs yesterday" is a fixed question.
	Comparison AnalyticsComparison `json:"comparison"`
	// GenerationFunnel is scoped by Days, like every other windowed figure
	// here.
	GenerationFunnel []AnalyticsFunnelStage `json:"generationFunnel"`
	HourOfDay        []AnalyticsHourBucket  `json:"hourOfDay"`
	// PeakHour is the busiest hour of the day across the window, or absent
	// when no job was submitted in it.
	PeakHour *AnalyticsHourBucket `json:"peakHour,omitempty"`
}

// WorldProjectionSummary is one row of the admin worlds table. It is the
// read-side shape of WorldSnapshot plus the projection's own bookkeeping —
// no field here is absent from the data-boundary allow list.
type WorldProjectionSummary struct {
	WorldID           string      `json:"worldId"`
	Family            WorldFamily `json:"family"`
	Nickname          string      `json:"nickname"`
	Role              string      `json:"role,omitempty"`
	Archetype         string      `json:"archetype"`
	SceneName         string      `json:"sceneName"`
	Mood              string      `json:"mood"`
	WorldStyle        string      `json:"worldStyle"`
	FavoriteColors    []string    `json:"favoriteColors"`
	TraitScores       TraitScores `json:"traitScores"`
	VariantCount      int         `json:"variantCount"`
	SelectedVariantNo int         `json:"selectedVariantNo"`
	IsPublished       bool        `json:"isPublished"`
	PublishedAt       *time.Time  `json:"publishedAt,omitempty"`
	Revision          int         `json:"revision"`
	SourceJobID       string      `json:"sourceJobId"`
	WorldCreatedAt    time.Time   `json:"worldCreatedAt"`
	ProjectedAt       time.Time   `json:"projectedAt"`
}

// AnalyticsWorldListQueryData embeds PageQueryData for the same reason the
// auth queries do: pagination is one shared shape and filters are additive
// fields on the specific query. Published is a pointer so "any" (nil) stays
// distinguishable from "explicitly unpublished" (false). Since/Until bound
// WorldCreatedAt and are pointers for the same "no bound" reason. Search
// matches Nickname — the one free-text field on the data boundary.
type AnalyticsWorldListQueryData struct {
	PageQueryData
	Family     WorldFamily `json:"family,omitempty"`
	Archetype  string      `json:"archetype,omitempty"`
	WorldStyle string      `json:"worldStyle,omitempty"`
	Mood       string      `json:"mood,omitempty"`
	Published  *bool       `json:"published,omitempty"`
	Since      *time.Time  `json:"since,omitempty"`
	Until      *time.Time  `json:"until,omitempty"`
	Search     string      `json:"search,omitempty"`
}

type AnalyticsWorldListResponseData struct {
	Worlds     []WorldProjectionSummary `json:"worlds"`
	NextCursor string                   `json:"nextCursor,omitempty"`
	TotalCount int                      `json:"totalCount"`
	PageSize   int                      `json:"pageSize"`
}

// AnalyticsWorldGetQueryData asks for one world. There is no family field
// because WorldID is already unique across families — world_projections keys
// on it alone, so asking for a family too would let a caller construct a
// mismatched pair that can only ever answer "not found".
type AnalyticsWorldGetQueryData struct {
	WorldID string `json:"worldId"`
}

// WorldProjectionDetail is WorldProjectionSummary plus the two identifiers a
// list has no room for. Both already cross the data boundary — the summary
// carries SourceJobID and JobProjectionSummary carries ProfileID and
// DNAVersionID — so this exposes nothing new, it only puts them where an
// operator tracing one world can see them together.
type WorldProjectionDetail struct {
	WorldProjectionSummary
	ProfileID    string `json:"profileId"`
	DNAVersionID string `json:"dnaVersionId"`
}

// AnalyticsWorldGetResponseData answers with the world and every job that
// produced or changed it, newest first. Jobs are joined on world_id rather
// than followed from SourceJobID because a world accumulates jobs after
// creation, and the source job is only the first of them.
type AnalyticsWorldGetResponseData struct {
	World WorldProjectionDetail  `json:"world"`
	Jobs  []JobProjectionSummary `json:"jobs"`
}

// JobProjectionSummary is one row of the admin jobs table. DurationMs is nil
// while a job is still in flight — an unfinished job has no duration, and a
// zero would read as an instant success.
type JobProjectionSummary struct {
	JobID        string      `json:"jobId"`
	Family       WorldFamily `json:"family,omitempty"`
	Status       JobStatus   `json:"status"`
	ErrorCode    string      `json:"errorCode,omitempty"`
	ErrorMessage string      `json:"errorMessage,omitempty"`
	WorldID      string      `json:"worldId,omitempty"`
	ProfileID    string      `json:"profileId,omitempty"`
	DNAVersionID string      `json:"dnaVersionId,omitempty"`
	CreatedAt    time.Time   `json:"createdAt"`
	CompletedAt  *time.Time  `json:"completedAt,omitempty"`
	DurationMs   *int        `json:"durationMs,omitempty"`
}

// Since/Until bound CreatedAt for the same "no bound" reason Published is a
// pointer on the world list query above. Search matches JobID or
// ErrorMessage — there is no other free-text column on job_projections.
type AnalyticsJobListQueryData struct {
	PageQueryData
	Family    WorldFamily `json:"family,omitempty"`
	Status    JobStatus   `json:"status,omitempty"`
	ErrorCode string      `json:"errorCode,omitempty"`
	Since     *time.Time  `json:"since,omitempty"`
	Until     *time.Time  `json:"until,omitempty"`
	Search    string      `json:"search,omitempty"`
}

type AnalyticsJobListResponseData struct {
	Jobs       []JobProjectionSummary `json:"jobs"`
	NextCursor string                 `json:"nextCursor,omitempty"`
	TotalCount int                    `json:"totalCount"`
	PageSize   int                    `json:"pageSize"`
}

// AnalyticsTimeseriesPoint is one day. Days with no activity are returned as
// explicit zeroes rather than omitted, so a chart renders a flat line instead
// of interpolating across a gap.
type AnalyticsTimeseriesPoint struct {
	Day            time.Time `json:"day"`
	WorldCount     int       `json:"worldCount"`
	PublishedCount int       `json:"publishedCount"`
	JobCount       int       `json:"jobCount"`
	FailedJobCount int       `json:"failedJobCount"`
}

type AnalyticsTimeseriesQueryData struct {
	Family WorldFamily `json:"family,omitempty"`
	Days   int         `json:"days,omitempty"`
}

type AnalyticsTimeseriesResponseData struct {
	Days   int                        `json:"days"`
	Points []AnalyticsTimeseriesPoint `json:"points"`
}

// NormalizePageSize and NormalizeDays are the single definition of these
// bounds. Callers that skip them get whatever the caller sent, which is
// exactly the unbounded-table problem the maximums exist to prevent.
func NormalizePageSize(pageSize int) int {
	if pageSize <= 0 {
		return AnalyticsDefaultPageSize
	}
	if pageSize > AnalyticsMaximumPageSize {
		return AnalyticsMaximumPageSize
	}
	return pageSize
}

func NormalizeDays(days int) int {
	if days <= 0 {
		return AnalyticsDefaultDays
	}
	if days > AnalyticsMaximumDays {
		return AnalyticsMaximumDays
	}
	return days
}
