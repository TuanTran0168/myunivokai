//! `TelemetryService` — the read and write policy, over a repository trait.

use std::sync::Arc;

use myunivokai_contracts::{
    HttpRollupEnvelope, TelemetryBackendSummary, TelemetryCacheSummary, TelemetryErrorCodeCount,
    TelemetryOverviewQueryData, TelemetryOverviewResponseData, TelemetryRouteListQueryData,
    TelemetryRouteListResponseData, TelemetryRouteSummary, TelemetrySinkDescriptor,
    TelemetryStatusClassCount, TelemetryVolumePoint,
};
use time::OffsetDateTime;

use crate::domain::{IngestOutcome, QueryWindow, RollupBatch};
use crate::error::Result;
use crate::repository::RollupRepository;

/// How many error codes the overview carries. The gateway declares well under
/// a dozen; ten is enough to see every one that matters and short enough that
/// a rare code cannot push a common one off a screen.
const ERROR_CODE_TOP_LIMIT: i64 = 10;

pub struct TelemetryService {
    repository: Arc<dyn RollupRepository>,
    retention_days: i64,
}

impl TelemetryService {
    pub fn new(repository: Arc<dyn RollupRepository>, retention_days: i64) -> Self {
        Self {
            repository,
            retention_days,
        }
    }

    /// Translates one envelope into the storage model and hands it to the
    /// repository. The translation is [`RollupBatch::from_envelope`]; the
    /// transaction is the repository's. This method exists so that neither of
    /// them has to know about the other.
    pub async fn ingest(&self, envelope: &HttpRollupEnvelope) -> Result<IngestOutcome> {
        let batch = RollupBatch::from_envelope(envelope)?;
        tracing::debug!(
            message_id = %batch.message_id,
            rows = batch.row_count(),
            "storing a telemetry rollup"
        );
        self.repository.record_batch(&batch).await
    }

    /// Assembles the Telemetry screen's top half from eight reads.
    ///
    /// They are eight statements rather than one join because they group
    /// differently — by nothing, by status class, by bucket, by error code, by
    /// service, by namespace — and a single query producing all of them would
    /// be a cross join nobody could read or explain the cost of.
    pub async fn overview(
        &self,
        query: &TelemetryOverviewQueryData,
        descriptor: TelemetrySinkDescriptor,
        now: OffsetDateTime,
    ) -> Result<TelemetryOverviewResponseData> {
        let window = QueryWindow::from_hours(query.hours);
        let since = window.since(now);

        let totals = self.repository.http_totals(since).await?;
        let status_mix = self.repository.status_mix(since).await?;
        let volume_buckets = self.repository.volume_buckets(since).await?;
        let error_codes = self
            .repository
            .top_error_codes(since, ERROR_CODE_TOP_LIMIT)
            .await?;
        let backends = self.repository.backend_aggregates(since).await?;
        let cache = self.repository.cache_aggregates(since).await?;
        let wake_signals = self.repository.wake_signals(since).await?;
        let oldest_bucket_start = self.repository.oldest_bucket_start().await?;

        Ok(TelemetryOverviewResponseData {
            sink: descriptor,
            hours: window.hours(),
            generated_at: now,
            total_requests: totals.requests,
            error_requests: totals.server_errors,
            error_rate_percent: percentage_of(totals.server_errors, totals.requests),
            average_duration_ms: totals.latency.average_ms(),
            p95_duration_ms: totals.latency.p95_ms(),
            slowest_duration_ms: totals.latency.slowest_ms(),
            // Always true when this service answered from its own storage. The
            // admin UI is required to render it next to the number: a p95 that
            // looks exact and is not is worse than no p95.
            percentile_is_interpolated: true,
            status_mix: status_mix
                .into_iter()
                .map(|slice| TelemetryStatusClassCount {
                    status_class: slice.status_class,
                    request_count: slice.requests,
                })
                .collect(),
            volume_points: volume_buckets
                .into_iter()
                .map(|bucket| TelemetryVolumePoint {
                    bucket_start: bucket.bucket_start,
                    request_count: bucket.requests,
                    error_count: bucket.server_errors,
                    p95_duration_ms: bucket.latency.p95_ms(),
                })
                .collect(),
            error_code_top: error_codes
                .into_iter()
                .map(|entry| TelemetryErrorCodeCount {
                    error_code: entry.error_code,
                    count: entry.count,
                })
                .collect(),
            backends: backends
                .into_iter()
                .map(|backend| TelemetryBackendSummary {
                    service: backend.service,
                    request_count: backend.requests,
                    error_count: backend.errors,
                    average_duration_ms: backend.latency.average_ms(),
                    p95_duration_ms: backend.latency.p95_ms(),
                    slowest_duration_ms: backend.latency.slowest_ms(),
                })
                .collect(),
            cache: cache
                .into_iter()
                .map(|namespace| TelemetryCacheSummary {
                    hit_rate_percent: percentage_of(
                        namespace.hits,
                        namespace.hits + namespace.misses,
                    ),
                    namespace: namespace.namespace,
                    hits: namespace.hits,
                    misses: namespace.misses,
                })
                .collect(),
            wake_signals: wake_signals
                .into_iter()
                .map(|bucket| TelemetryVolumePoint {
                    bucket_start: bucket.bucket_start,
                    request_count: bucket.count,
                    error_count: 0,
                    p95_duration_ms: 0,
                })
                .collect(),
            oldest_bucket_start,
        })
    }

    pub async fn routes(
        &self,
        query: &TelemetryRouteListQueryData,
        descriptor: TelemetrySinkDescriptor,
        now: OffsetDateTime,
    ) -> Result<TelemetryRouteListResponseData> {
        let window = QueryWindow::from_hours(query.hours);
        let routes = self.repository.route_aggregates(window.since(now)).await?;

        Ok(TelemetryRouteListResponseData {
            sink: descriptor,
            hours: window.hours(),
            generated_at: now,
            percentile_is_interpolated: true,
            routes: routes
                .into_iter()
                .map(|route| TelemetryRouteSummary {
                    error_rate_percent: percentage_of(route.server_errors, route.requests),
                    average_duration_ms: route.latency.average_ms(),
                    p95_duration_ms: route.latency.p95_ms(),
                    slowest_duration_ms: route.latency.slowest_ms(),
                    route_pattern: route.route_pattern,
                    method: route.method,
                    request_count: route.requests,
                    error_count: route.server_errors,
                })
                .collect(),
        })
    }

    /// Deletes everything past the retention window. There is no
    /// rollup-of-rollups anywhere in this service: a bucket is already one
    /// minute wide, so the only thing old data becomes is deleted.
    pub async fn prune(&self, now: OffsetDateTime) -> Result<u64> {
        let cutoff = now - time::Duration::days(self.retention_days);
        self.repository.delete_before(cutoff).await
    }
}

/// Percentages are computed in exactly one place so that "error rate" and
/// "hit rate" cannot end up rounding differently on two screens.
fn percentage_of(part: i64, total: i64) -> f64 {
    if total <= 0 {
        return 0.0;
    }
    (part as f64 * 100.0 / total as f64 * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::memory::InMemoryRollupRepository;
    use crate::testing::{rollup_envelope, TestBucket};
    use myunivokai_contracts::TELEMETRY_SINK_POSTGRES;
    use time::macros::datetime;

    fn descriptor() -> TelemetrySinkDescriptor {
        TelemetrySinkDescriptor {
            sink: TELEMETRY_SINK_POSTGRES.to_owned(),
            charts_available: true,
            dashboard_url: String::new(),
        }
    }

    fn service_with(repository: Arc<InMemoryRollupRepository>) -> TelemetryService {
        TelemetryService::new(repository, 90)
    }

    #[test]
    fn percentages_round_to_two_places_and_survive_an_empty_window() {
        assert_eq!(percentage_of(0, 0), 0.0);
        assert_eq!(percentage_of(1, 3), 33.33);
        assert_eq!(percentage_of(50, 100), 50.0);
    }

    #[tokio::test]
    async fn a_redelivered_envelope_moves_no_counter() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository.clone());
        let envelope = rollup_envelope(
            "instance-a",
            datetime!(2026-08-13 09:14:00 UTC),
            &[TestBucket::successful("/api/universe/worlds", 10, 500, 90)],
        );

        assert_eq!(
            service.ingest(&envelope).await.expect("first delivery"),
            IngestOutcome::Stored
        );
        assert_eq!(
            service.ingest(&envelope).await.expect("redelivery"),
            IngestOutcome::AlreadyStored
        );

        let overview = service
            .overview(
                &TelemetryOverviewQueryData { hours: 24 },
                descriptor(),
                datetime!(2026-08-13 10:00:00 UTC),
            )
            .await
            .expect("overview");
        assert_eq!(
            overview.total_requests, 10,
            "the redelivery double-counted the interval"
        );
    }

    // Two gateway instances flushing the same minute are two facts, not a
    // duplicate. This is the case the message id exists to keep apart.
    #[tokio::test]
    async fn two_instances_reporting_one_minute_are_added_together() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let bucket_start = datetime!(2026-08-13 09:14:00 UTC);
        for instance in ["instance-a", "instance-b"] {
            let envelope = rollup_envelope(
                instance,
                bucket_start,
                &[TestBucket::successful("/api/universe/worlds", 4, 200, 80)],
            );
            assert_eq!(
                service.ingest(&envelope).await.expect("ingest"),
                IngestOutcome::Stored
            );
        }

        let overview = service
            .overview(
                &TelemetryOverviewQueryData { hours: 24 },
                descriptor(),
                datetime!(2026-08-13 10:00:00 UTC),
            )
            .await
            .expect("overview");
        assert_eq!(overview.total_requests, 8);
        assert_eq!(
            overview.volume_points.len(),
            1,
            "one minute, one chart point"
        );
    }

    // 4xx is the client's problem. Folding it in would produce an error rate
    // that never goes down.
    #[tokio::test]
    async fn the_error_rate_counts_server_errors_only() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let envelope = rollup_envelope(
            "instance-a",
            datetime!(2026-08-13 09:14:00 UTC),
            &[
                TestBucket::successful("/api/universe/worlds", 90, 900, 40),
                TestBucket::with_status("/api/universe/worlds", 4, 8, 80, 40),
                TestBucket::with_status("/api/universe/worlds", 5, 2, 20, 40)
                    .with_error_code("SERVICE_WAKING", 2),
            ],
        );
        service.ingest(&envelope).await.expect("ingest");

        let overview = service
            .overview(
                &TelemetryOverviewQueryData { hours: 24 },
                descriptor(),
                datetime!(2026-08-13 10:00:00 UTC),
            )
            .await
            .expect("overview");

        assert_eq!(overview.total_requests, 100);
        assert_eq!(overview.error_requests, 2);
        assert_eq!(overview.error_rate_percent, 2.0);
        assert_eq!(
            overview.status_mix.len(),
            3,
            "every class is still reported"
        );
        assert_eq!(overview.error_code_top[0].error_code, "SERVICE_WAKING");
        assert_eq!(overview.wake_signals.len(), 1);
    }

    #[tokio::test]
    async fn a_window_excludes_anything_older_than_itself() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let now = datetime!(2026-08-13 12:00:00 UTC);
        service
            .ingest(&rollup_envelope(
                "instance-a",
                now - time::Duration::hours(2),
                &[TestBucket::successful("/api/universe/worlds", 5, 50, 20)],
            ))
            .await
            .expect("recent");
        service
            .ingest(&rollup_envelope(
                "instance-a",
                now - time::Duration::hours(48),
                &[TestBucket::successful("/api/universe/worlds", 7, 70, 20)],
            ))
            .await
            .expect("old");

        let recent = service
            .overview(&TelemetryOverviewQueryData { hours: 6 }, descriptor(), now)
            .await
            .expect("overview");
        assert_eq!(recent.total_requests, 5);
        assert_eq!(recent.hours, 6);

        let wider = service
            .overview(&TelemetryOverviewQueryData { hours: 72 }, descriptor(), now)
            .await
            .expect("overview");
        assert_eq!(wider.total_requests, 12);
    }

    // A window the service silently shrank would make the screen lie about
    // what it is showing, so the clamped value is returned rather than the one
    // that was asked for.
    #[tokio::test]
    async fn an_unbounded_window_is_clamped_and_says_so() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let overview = service
            .overview(
                &TelemetryOverviewQueryData { hours: 100_000 },
                descriptor(),
                datetime!(2026-08-13 12:00:00 UTC),
            )
            .await
            .expect("overview");
        assert_eq!(overview.hours, 168);
    }

    #[tokio::test]
    async fn routes_are_returned_busiest_first_with_their_own_error_rate() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let envelope = rollup_envelope(
            "instance-a",
            datetime!(2026-08-13 09:14:00 UTC),
            &[
                TestBucket::successful("/api/universe/worlds/{worldID}", 40, 400, 30),
                TestBucket::successful("/api/universe/worlds", 8, 800, 300),
                TestBucket::with_status("/api/universe/worlds", 5, 2, 60, 40),
            ],
        );
        service.ingest(&envelope).await.expect("ingest");

        let listed = service
            .routes(
                &TelemetryRouteListQueryData { hours: 24 },
                descriptor(),
                datetime!(2026-08-13 10:00:00 UTC),
            )
            .await
            .expect("routes");

        assert_eq!(listed.routes.len(), 2);
        assert_eq!(
            listed.routes[0].route_pattern,
            "/api/universe/worlds/{worldID}"
        );
        assert_eq!(listed.routes[0].request_count, 40);
        assert_eq!(listed.routes[0].error_rate_percent, 0.0);
        assert_eq!(listed.routes[1].request_count, 10);
        assert_eq!(listed.routes[1].error_count, 2);
        assert_eq!(listed.routes[1].error_rate_percent, 20.0);
        assert!(listed.percentile_is_interpolated);
    }

    #[tokio::test]
    async fn retention_deletes_only_what_is_past_the_window() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = TelemetryService::new(repository, 1);
        let now = datetime!(2026-08-13 12:00:00 UTC);
        service
            .ingest(&rollup_envelope(
                "instance-a",
                now - time::Duration::hours(2),
                &[TestBucket::successful("/api/universe/worlds", 1, 10, 10)],
            ))
            .await
            .expect("recent");
        service
            .ingest(&rollup_envelope(
                "instance-a",
                now - time::Duration::days(3),
                &[TestBucket::successful("/api/universe/worlds", 1, 10, 10)],
            ))
            .await
            .expect("old");

        let deleted = service.prune(now).await.expect("prune");
        assert_eq!(deleted, 1);

        let remaining = service
            .overview(
                &TelemetryOverviewQueryData { hours: 168 },
                descriptor(),
                now,
            )
            .await
            .expect("overview");
        assert_eq!(remaining.total_requests, 1);
    }

    #[tokio::test]
    async fn a_storage_failure_reaches_the_caller_as_a_retryable_error() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        repository.fail_next_call("database unreachable");
        let service = service_with(repository);

        let error = service
            .ingest(&rollup_envelope(
                "instance-a",
                datetime!(2026-08-13 09:14:00 UTC),
                &[TestBucket::successful("/api/universe/worlds", 1, 10, 10)],
            ))
            .await
            .expect_err("must fail");

        assert!(
            error.is_retryable(),
            "a database blip must be naked, not acked"
        );
        assert_eq!(error.describe().status_code, 500);
    }
}
