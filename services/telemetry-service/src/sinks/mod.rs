//! The one small interface every destination implements, and the switch that
//! chooses between them at boot.
//!
//! This is `ai.Provider`'s shape, not a new one: one trait, adapters in their
//! own module, selected by one environment variable read once at startup. The
//! rest of the service is written against `TelemetrySink` and never against a
//! concrete sink, which is what makes "both can run at once" a future
//! `FanoutSink` wrapping two inner sinks rather than a fork.

pub mod otlp;
pub mod postgres;

use async_trait::async_trait;
use myunivokai_contracts::{
    HttpRollupEnvelope, TelemetryOverviewQueryData, TelemetryOverviewResponseData,
    TelemetryRouteListQueryData, TelemetryRouteListResponseData, TelemetrySinkDescriptor,
};
use time::OffsetDateTime;

/// What happened to one envelope, so that a redelivery can be logged as the
/// no-op it is instead of looking like a second write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    Applied,
    AlreadyApplied,
}

#[derive(Debug, thiserror::Error)]
pub enum SinkError {
    /// This sink stores nothing locally, so it cannot answer a range query.
    ///
    /// It is an error at the trait boundary and deliberately NOT an error on
    /// the wire: the query handler turns it into a successful response whose
    /// `chartsAvailable` is false and whose `dashboardUrl` says where to look.
    /// A missing chart must read as "look elsewhere", never as a broken
    /// screen - see notes/vision/telemetry-service-plan.md#admin-surface.
    #[error("this sink cannot answer range queries: {0}")]
    Unsupported(&'static str),

    #[error("telemetry storage failed: {0}")]
    Storage(#[from] sqlx::Error),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[async_trait]
pub trait TelemetrySink: Send + Sync {
    /// Names this sink and states whether it can be charted from, on every
    /// response rather than only on the ones that fail.
    fn descriptor(&self) -> TelemetrySinkDescriptor;

    async fn write_rollup(&self, envelope: &HttpRollupEnvelope) -> Result<WriteOutcome, SinkError>;

    async fn overview(
        &self,
        query: &TelemetryOverviewQueryData,
    ) -> Result<TelemetryOverviewResponseData, SinkError>;

    async fn routes(
        &self,
        query: &TelemetryRouteListQueryData,
    ) -> Result<TelemetryRouteListResponseData, SinkError>;

    /// Deletes anything older than the configured retention. Returns the row
    /// count so a sweep that quietly stops working is visible in a log line
    /// rather than only in a disk graph months later.
    ///
    /// A sink with no storage of its own answers zero rather than refusing:
    /// there is nothing to delete, which is a successful outcome.
    async fn prune(&self) -> Result<u64, SinkError> {
        Ok(0)
    }
}

/// The empty answer a sink that stores nothing produces, built from its own
/// descriptor so the screen has a sink name and a dashboard link to render.
pub fn unavailable_overview(
    descriptor: TelemetrySinkDescriptor,
    hours: i64,
    generated_at: OffsetDateTime,
) -> TelemetryOverviewResponseData {
    TelemetryOverviewResponseData {
        sink: descriptor,
        hours,
        generated_at,
        total_requests: 0,
        error_requests: 0,
        error_rate_percent: 0.0,
        average_duration_ms: 0,
        p95_duration_ms: 0,
        slowest_duration_ms: 0,
        percentile_is_interpolated: false,
        status_mix: Vec::new(),
        volume_points: Vec::new(),
        error_code_top: Vec::new(),
        backends: Vec::new(),
        cache: Vec::new(),
        wake_signals: Vec::new(),
        oldest_bucket_start: None,
    }
}

pub fn unavailable_routes(
    descriptor: TelemetrySinkDescriptor,
    hours: i64,
    generated_at: OffsetDateTime,
) -> TelemetryRouteListResponseData {
    TelemetryRouteListResponseData {
        sink: descriptor,
        hours,
        generated_at,
        percentile_is_interpolated: false,
        routes: Vec::new(),
    }
}

/// Percentages are computed in exactly one place so that "error rate" and
/// "hit rate" cannot end up rounding differently on two screens.
pub fn percentage_of(part: i64, total: i64) -> f64 {
    if total <= 0 {
        return 0.0;
    }
    (part as f64 * 100.0 / total as f64 * 100.0).round() / 100.0
}

/// An average that answers zero for an empty window rather than dividing by
/// it. A window with no traffic has no average latency, and reporting one
/// would put a number on a chart that describes nothing.
pub fn average_of(sum: i64, count: i64) -> i64 {
    if count <= 0 {
        return 0;
    }
    sum / count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentages_round_to_two_places_and_survive_an_empty_window() {
        assert_eq!(percentage_of(0, 0), 0.0);
        assert_eq!(percentage_of(1, 3), 33.33);
        assert_eq!(percentage_of(50, 100), 50.0);
        assert_eq!(percentage_of(7, 0), 0.0);
    }

    #[test]
    fn an_empty_window_has_no_average_rather_than_a_division_by_zero() {
        assert_eq!(average_of(0, 0), 0);
        assert_eq!(average_of(300, 4), 75);
    }
}
