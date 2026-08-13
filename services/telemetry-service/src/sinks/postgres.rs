//! The sink that stores rollups in this repository's own schema, and answers
//! the admin app's queries over the same rows it just wrote.
//!
//! It exists so the Telemetry screen can render request volume, status mix and
//! per-route latency without an external vendor in the loop. Everything it
//! reports is a sum over `myunivokai_telemetry`; nothing is computed anywhere
//! else and nothing is fetched from another service.

use std::time::Duration as StdDuration;

use async_trait::async_trait;
use myunivokai_contracts::{
    normalize_telemetry_hours, percentile_from_histogram, telemetry_rollup_message_id,
    HttpRollupEnvelope, TelemetryBackendSummary, TelemetryCacheSummary, TelemetryErrorCodeCount,
    TelemetryHistogram, TelemetryOverviewQueryData, TelemetryOverviewResponseData,
    TelemetryRouteListQueryData, TelemetryRouteListResponseData, TelemetryRouteSummary,
    TelemetrySinkDescriptor, TelemetryStatusClassCount, TelemetryVolumePoint,
    TELEMETRY_HISTOGRAM_BUCKET_COUNT, TELEMETRY_HTTP_ROLLUP_EVENT_SUBJECT, TELEMETRY_SINK_POSTGRES,
};
use sqlx::postgres::{PgPoolOptions, PgRow};
use sqlx::{PgPool, Row};
use time::OffsetDateTime;

use super::{average_of, percentage_of, SinkError, TelemetrySink, WriteOutcome};
use crate::config::Config;

/// The percentile the admin screen shows. p95 rather than p99 because a
/// minute-wide bucket on a low-traffic service often holds fewer than a
/// hundred requests, and a p99 over 40 observations is one observation wearing
/// a statistic's name.
const REPORTED_PERCENTILE: f64 = 95.0;

/// A status class of 5 or above is what "error rate" counts. 4xx is excluded
/// deliberately: a validation failure or a 404 is the client's problem and
/// including it would make an error rate that never goes down. The full status
/// mix is returned alongside, so nothing is hidden - only kept out of the one
/// number an operator is expected to react to.
const SERVER_ERROR_STATUS_CLASS: i16 = 5;

/// The gateway's own code for "the service is starting up". Counting it per
/// bucket is what makes the wake-conversion question answerable at all.
const WAKE_SIGNAL_ERROR_CODE: &str = "SERVICE_WAKING";

const ERROR_CODE_TOP_LIMIT: i64 = 10;

const HISTOGRAM_COLUMN_NAMES: [&str; TELEMETRY_HISTOGRAM_BUCKET_COUNT] = [
    "histogram_1",
    "histogram_2",
    "histogram_3",
    "histogram_4",
    "histogram_5",
    "histogram_6",
    "histogram_7",
    "histogram_8",
];

/// A compile-time constant, not user input. It is interpolated into the
/// queries below with `format!` only because the same eight columns are needed
/// in four places, and repeating them four times is how one of the four ends
/// up summing a different bucket than the others.
const HISTOGRAM_SUM_COLUMNS: &str = "
    COALESCE(SUM(histogram[1]), 0)::BIGINT AS histogram_1,
    COALESCE(SUM(histogram[2]), 0)::BIGINT AS histogram_2,
    COALESCE(SUM(histogram[3]), 0)::BIGINT AS histogram_3,
    COALESCE(SUM(histogram[4]), 0)::BIGINT AS histogram_4,
    COALESCE(SUM(histogram[5]), 0)::BIGINT AS histogram_5,
    COALESCE(SUM(histogram[6]), 0)::BIGINT AS histogram_6,
    COALESCE(SUM(histogram[7]), 0)::BIGINT AS histogram_7,
    COALESCE(SUM(histogram[8]), 0)::BIGINT AS histogram_8";

/// Every SUM over a BIGINT column is cast back to BIGINT.
///
/// Postgres widens `SUM(bigint)` to `numeric`, which would drag an arbitrary-
/// precision decimal type into this service for totals that cannot exceed a
/// request count. The cast keeps the wire types the same on both sides.
const SELECT_TOTALS_SQL: &str = "
SELECT
    COALESCE(SUM(request_count), 0)::BIGINT AS request_count,
    COALESCE(SUM(request_count) FILTER (WHERE status_class >= $2), 0)::BIGINT AS error_count,
    COALESCE(SUM(duration_sum_ms), 0)::BIGINT AS duration_sum_ms,
    COALESCE(MAX(duration_max_ms), 0)::BIGINT AS duration_max_ms,
{histogram_columns}
FROM http_rollups
WHERE bucket_start >= $1";

const SELECT_STATUS_MIX_SQL: &str = "
SELECT status_class, COALESCE(SUM(request_count), 0)::BIGINT AS request_count
FROM http_rollups
WHERE bucket_start >= $1
GROUP BY status_class
ORDER BY status_class";

const SELECT_VOLUME_POINTS_SQL: &str = "
SELECT
    bucket_start,
    COALESCE(SUM(request_count), 0)::BIGINT AS request_count,
    COALESCE(SUM(request_count) FILTER (WHERE status_class >= $2), 0)::BIGINT AS error_count,
    COALESCE(MAX(duration_max_ms), 0)::BIGINT AS duration_max_ms,
{histogram_columns}
FROM http_rollups
WHERE bucket_start >= $1
GROUP BY bucket_start
ORDER BY bucket_start";

const SELECT_ERROR_CODE_TOP_SQL: &str = "
SELECT error_code, COALESCE(SUM(count), 0)::BIGINT AS count
FROM error_code_rollups
WHERE bucket_start >= $1
GROUP BY error_code
ORDER BY SUM(count) DESC, error_code
LIMIT $2";

const SELECT_WAKE_SIGNALS_SQL: &str = "
SELECT bucket_start, COALESCE(SUM(count), 0)::BIGINT AS count
FROM error_code_rollups
WHERE bucket_start >= $1 AND error_code = $2
GROUP BY bucket_start
ORDER BY bucket_start";

const SELECT_BACKENDS_SQL: &str = "
SELECT
    service,
    COALESCE(SUM(request_count), 0)::BIGINT AS request_count,
    COALESCE(SUM(error_count), 0)::BIGINT AS error_count,
    COALESCE(SUM(duration_sum_ms), 0)::BIGINT AS duration_sum_ms,
    COALESCE(MAX(duration_max_ms), 0)::BIGINT AS duration_max_ms,
{histogram_columns}
FROM nats_rollups
WHERE bucket_start >= $1
GROUP BY service
ORDER BY service";

const SELECT_CACHE_SQL: &str = "
SELECT
    namespace,
    COALESCE(SUM(hits), 0)::BIGINT AS hits,
    COALESCE(SUM(misses), 0)::BIGINT AS misses
FROM cache_rollups
WHERE bucket_start >= $1
GROUP BY namespace
ORDER BY namespace";

const SELECT_OLDEST_BUCKET_SQL: &str = "SELECT MIN(bucket_start) AS oldest_bucket_start FROM http_rollups";

const SELECT_ROUTES_SQL: &str = "
SELECT
    route_pattern,
    method,
    COALESCE(SUM(request_count), 0)::BIGINT AS request_count,
    COALESCE(SUM(request_count) FILTER (WHERE status_class >= $2), 0)::BIGINT AS error_count,
    COALESCE(SUM(duration_sum_ms), 0)::BIGINT AS duration_sum_ms,
    COALESCE(MAX(duration_max_ms), 0)::BIGINT AS duration_max_ms,
{histogram_columns}
FROM http_rollups
WHERE bucket_start >= $1
GROUP BY route_pattern, method
ORDER BY SUM(request_count) DESC, route_pattern, method";

const INSERT_INBOX_SQL: &str = "
INSERT INTO inbox_messages (message_id, subject)
VALUES ($1, $2)
ON CONFLICT (message_id) DO NOTHING";

/// The histogram is summed elementwise inside the conflict clause, which is
/// what makes two instances reporting the same minute add up instead of one
/// overwriting the other. `duration_max_ms` takes the greater of the two,
/// because a maximum is not additive.
const UPSERT_HTTP_ROLLUP_SQL: &str = "
INSERT INTO http_rollups
    (bucket_start, route_pattern, method, status_class, request_count, duration_sum_ms, duration_max_ms, histogram)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (bucket_start, route_pattern, method, status_class) DO UPDATE SET
    request_count   = http_rollups.request_count + EXCLUDED.request_count,
    duration_sum_ms = http_rollups.duration_sum_ms + EXCLUDED.duration_sum_ms,
    duration_max_ms = GREATEST(http_rollups.duration_max_ms, EXCLUDED.duration_max_ms),
    histogram       = (
        SELECT ARRAY_AGG(pair.stored + pair.incoming ORDER BY pair.position)
        FROM UNNEST(http_rollups.histogram, EXCLUDED.histogram)
             WITH ORDINALITY AS pair(stored, incoming, position)
    )";

const UPSERT_ERROR_CODE_ROLLUP_SQL: &str = "
INSERT INTO error_code_rollups (bucket_start, error_code, count)
VALUES ($1, $2, $3)
ON CONFLICT (bucket_start, error_code) DO UPDATE SET
    count = error_code_rollups.count + EXCLUDED.count";

const UPSERT_NATS_ROLLUP_SQL: &str = "
INSERT INTO nats_rollups
    (bucket_start, service, request_count, duration_sum_ms, duration_max_ms, histogram, error_count)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (bucket_start, service) DO UPDATE SET
    request_count   = nats_rollups.request_count + EXCLUDED.request_count,
    duration_sum_ms = nats_rollups.duration_sum_ms + EXCLUDED.duration_sum_ms,
    duration_max_ms = GREATEST(nats_rollups.duration_max_ms, EXCLUDED.duration_max_ms),
    error_count     = nats_rollups.error_count + EXCLUDED.error_count,
    histogram       = (
        SELECT ARRAY_AGG(pair.stored + pair.incoming ORDER BY pair.position)
        FROM UNNEST(nats_rollups.histogram, EXCLUDED.histogram)
             WITH ORDINALITY AS pair(stored, incoming, position)
    )";

const UPSERT_CACHE_ROLLUP_SQL: &str = "
INSERT INTO cache_rollups (bucket_start, namespace, hits, misses)
VALUES ($1, $2, $3, $4)
ON CONFLICT (bucket_start, namespace) DO UPDATE SET
    hits   = cache_rollups.hits + EXCLUDED.hits,
    misses = cache_rollups.misses + EXCLUDED.misses";

/// Retention is a delete, not a policy document. The inbox is pruned by the
/// same cutoff: its rows are only useful for as long as JetStream could still
/// redeliver the envelope they describe, which is far shorter than the rollup
/// retention.
const PRUNE_STATEMENTS: [&str; 5] = [
    "DELETE FROM http_rollups WHERE bucket_start < $1",
    "DELETE FROM error_code_rollups WHERE bucket_start < $1",
    "DELETE FROM nats_rollups WHERE bucket_start < $1",
    "DELETE FROM cache_rollups WHERE bucket_start < $1",
    "DELETE FROM inbox_messages WHERE processed_at < $1",
];

pub struct PostgresSink {
    pool: PgPool,
    retention_days: i64,
}

impl PostgresSink {
    pub async fn connect(config: &Config) -> anyhow::Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(config.database_maximum_connections)
            .acquire_timeout(StdDuration::from_secs(10))
            .connect(&config.database_url)
            .await?;
        Ok(Self {
            pool,
            retention_days: config.retention_days,
        })
    }

    pub async fn close(&self) {
        self.pool.close().await;
    }
}

/// Migrations run against the DIRECT url when one is supplied, because Neon's
/// pooled endpoint cannot execute DDL - the same reason every Go service here
/// carries the pair.
///
/// Unlike those services this needs no MIGRATIONS_DIR at runtime: `migrate!`
/// embeds the SQL files into the binary at compile time, so the container
/// cannot start with a migrations directory that does not match its own code.
pub async fn run_migrations(config: &Config) -> anyhow::Result<()> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(StdDuration::from_secs(30))
        .connect(config.migration_database_url())
        .await?;
    let result = sqlx::migrate!("./migrations").run(&pool).await;
    pool.close().await;
    Ok(result?)
}

#[async_trait]
impl TelemetrySink for PostgresSink {
    fn descriptor(&self) -> TelemetrySinkDescriptor {
        TelemetrySinkDescriptor {
            sink: TELEMETRY_SINK_POSTGRES.to_owned(),
            charts_available: true,
            dashboard_url: String::new(),
        }
    }

    /// One transaction per envelope, inbox row first.
    ///
    /// Writing the inbox row first and abandoning the transaction when it
    /// conflicts is what makes a redelivery a no-op rather than a double
    /// count: every accumulation below adds, so applying one envelope twice
    /// would silently double an interval with nothing to detect it afterwards.
    async fn write_rollup(&self, envelope: &HttpRollupEnvelope) -> Result<WriteOutcome, SinkError> {
        let data = &envelope.data;
        // Derived from the payload rather than read from the envelope's jobId
        // or the Nats-Msg-Id header. Identity that comes from the content
        // cannot be spoofed by a publisher that fills the field in wrongly,
        // and it stays correct if a future publisher forgets the header.
        let message_id = telemetry_rollup_message_id(&data.instance_id, data.bucket_start);

        let mut transaction = self.pool.begin().await?;
        let inserted = sqlx::query(INSERT_INBOX_SQL)
            .bind(message_id.as_str())
            .bind(TELEMETRY_HTTP_ROLLUP_EVENT_SUBJECT)
            .execute(&mut *transaction)
            .await?
            .rows_affected();
        if inserted == 0 {
            transaction.rollback().await?;
            return Ok(WriteOutcome::AlreadyApplied);
        }

        for bucket in &data.buckets {
            sqlx::query(UPSERT_HTTP_ROLLUP_SQL)
                .bind(data.bucket_start)
                .bind(bucket.route_pattern.as_str())
                .bind(bucket.method.as_str())
                .bind(i16::from(bucket.status_class))
                .bind(bucket.request_count)
                .bind(bucket.duration_sum_ms)
                .bind(bucket.duration_max_ms)
                .bind(bucket.histogram.to_vec())
                .execute(&mut *transaction)
                .await?;

            for (error_code, count) in &bucket.error_codes {
                sqlx::query(UPSERT_ERROR_CODE_ROLLUP_SQL)
                    .bind(data.bucket_start)
                    .bind(error_code.as_str())
                    .bind(*count)
                    .execute(&mut *transaction)
                    .await?;
            }
        }

        for bucket in &data.nats_backend_buckets {
            sqlx::query(UPSERT_NATS_ROLLUP_SQL)
                .bind(data.bucket_start)
                .bind(bucket.service.as_str())
                .bind(bucket.request_count)
                .bind(bucket.duration_sum_ms)
                .bind(bucket.duration_max_ms)
                .bind(bucket.histogram.to_vec())
                .bind(bucket.error_count)
                .execute(&mut *transaction)
                .await?;
        }

        for bucket in &data.cache_buckets {
            sqlx::query(UPSERT_CACHE_ROLLUP_SQL)
                .bind(data.bucket_start)
                .bind(bucket.namespace.as_str())
                .bind(bucket.hits)
                .bind(bucket.misses)
                .execute(&mut *transaction)
                .await?;
        }

        transaction.commit().await?;
        Ok(WriteOutcome::Applied)
    }

    async fn overview(
        &self,
        query: &TelemetryOverviewQueryData,
    ) -> Result<TelemetryOverviewResponseData, SinkError> {
        let hours = normalize_telemetry_hours(query.hours);
        let since = window_start(hours);

        let totals = sqlx::query(&with_histogram_columns(SELECT_TOTALS_SQL))
            .bind(since)
            .bind(SERVER_ERROR_STATUS_CLASS)
            .fetch_one(&self.pool)
            .await?;
        let total_requests: i64 = totals.try_get("request_count")?;
        let error_requests: i64 = totals.try_get("error_count")?;
        let duration_sum_ms: i64 = totals.try_get("duration_sum_ms")?;
        let slowest_duration_ms: i64 = totals.try_get("duration_max_ms")?;
        let histogram = histogram_from_row(&totals)?;

        let status_mix = sqlx::query(SELECT_STATUS_MIX_SQL)
            .bind(since)
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(|row| {
                Ok(TelemetryStatusClassCount {
                    status_class: row.try_get::<i16, _>("status_class")? as u8,
                    request_count: row.try_get("request_count")?,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()?;

        let volume_points = sqlx::query(&with_histogram_columns(SELECT_VOLUME_POINTS_SQL))
            .bind(since)
            .bind(SERVER_ERROR_STATUS_CLASS)
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(volume_point_from_row)
            .collect::<Result<Vec<_>, sqlx::Error>>()?;

        let error_code_top = sqlx::query(SELECT_ERROR_CODE_TOP_SQL)
            .bind(since)
            .bind(ERROR_CODE_TOP_LIMIT)
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(|row| {
                Ok(TelemetryErrorCodeCount {
                    error_code: row.try_get("error_code")?,
                    count: row.try_get("count")?,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()?;

        let backends = sqlx::query(&with_histogram_columns(SELECT_BACKENDS_SQL))
            .bind(since)
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(backend_summary_from_row)
            .collect::<Result<Vec<_>, sqlx::Error>>()?;

        let cache = sqlx::query(SELECT_CACHE_SQL)
            .bind(since)
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(|row| {
                let hits: i64 = row.try_get("hits")?;
                let misses: i64 = row.try_get("misses")?;
                Ok(TelemetryCacheSummary {
                    namespace: row.try_get("namespace")?,
                    hits,
                    misses,
                    hit_rate_percent: percentage_of(hits, hits + misses),
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()?;

        // An approximation joined on time proximity, not a per-request causal
        // trace. The admin UI is required to say so; an exact version would be
        // a wake_outcome dimension on the bucket itself, which nobody has
        // asked for.
        let wake_signals = sqlx::query(SELECT_WAKE_SIGNALS_SQL)
            .bind(since)
            .bind(WAKE_SIGNAL_ERROR_CODE)
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(|row| {
                Ok(TelemetryVolumePoint {
                    bucket_start: row.try_get("bucket_start")?,
                    request_count: row.try_get("count")?,
                    error_count: 0,
                    p95_duration_ms: 0,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()?;

        let oldest_bucket_start: Option<OffsetDateTime> = sqlx::query(SELECT_OLDEST_BUCKET_SQL)
            .fetch_one(&self.pool)
            .await?
            .try_get("oldest_bucket_start")?;

        Ok(TelemetryOverviewResponseData {
            sink: self.descriptor(),
            hours,
            generated_at: OffsetDateTime::now_utc(),
            total_requests,
            error_requests,
            error_rate_percent: percentage_of(error_requests, total_requests),
            average_duration_ms: average_of(duration_sum_ms, total_requests),
            p95_duration_ms: percentile_from_histogram(
                &histogram,
                REPORTED_PERCENTILE,
                slowest_duration_ms,
            ),
            slowest_duration_ms,
            percentile_is_interpolated: true,
            status_mix,
            volume_points,
            error_code_top,
            backends,
            cache,
            wake_signals,
            oldest_bucket_start,
        })
    }

    async fn routes(
        &self,
        query: &TelemetryRouteListQueryData,
    ) -> Result<TelemetryRouteListResponseData, SinkError> {
        let hours = normalize_telemetry_hours(query.hours);
        let routes = sqlx::query(&with_histogram_columns(SELECT_ROUTES_SQL))
            .bind(window_start(hours))
            .bind(SERVER_ERROR_STATUS_CLASS)
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(route_summary_from_row)
            .collect::<Result<Vec<_>, sqlx::Error>>()?;

        Ok(TelemetryRouteListResponseData {
            sink: self.descriptor(),
            hours,
            generated_at: OffsetDateTime::now_utc(),
            percentile_is_interpolated: true,
            routes,
        })
    }

    async fn prune(&self) -> Result<u64, SinkError> {
        let cutoff = OffsetDateTime::now_utc() - time::Duration::days(self.retention_days);
        let mut deleted = 0;
        for statement in PRUNE_STATEMENTS {
            deleted += sqlx::query(statement)
                .bind(cutoff)
                .execute(&self.pool)
                .await?
                .rows_affected();
        }
        Ok(deleted)
    }
}

fn window_start(hours: i64) -> OffsetDateTime {
    OffsetDateTime::now_utc() - time::Duration::hours(hours)
}

fn with_histogram_columns(statement: &str) -> String {
    statement.replace("{histogram_columns}", HISTOGRAM_SUM_COLUMNS)
}

fn histogram_from_row(row: &PgRow) -> Result<TelemetryHistogram, sqlx::Error> {
    let mut histogram: TelemetryHistogram = [0; TELEMETRY_HISTOGRAM_BUCKET_COUNT];
    for (index, column_name) in HISTOGRAM_COLUMN_NAMES.iter().enumerate() {
        histogram[index] = row.try_get(*column_name)?;
    }
    Ok(histogram)
}

fn volume_point_from_row(row: &PgRow) -> Result<TelemetryVolumePoint, sqlx::Error> {
    let slowest_duration_ms: i64 = row.try_get("duration_max_ms")?;
    Ok(TelemetryVolumePoint {
        bucket_start: row.try_get("bucket_start")?,
        request_count: row.try_get("request_count")?,
        error_count: row.try_get("error_count")?,
        p95_duration_ms: percentile_from_histogram(
            &histogram_from_row(row)?,
            REPORTED_PERCENTILE,
            slowest_duration_ms,
        ),
    })
}

fn backend_summary_from_row(row: &PgRow) -> Result<TelemetryBackendSummary, sqlx::Error> {
    let request_count: i64 = row.try_get("request_count")?;
    let duration_sum_ms: i64 = row.try_get("duration_sum_ms")?;
    let slowest_duration_ms: i64 = row.try_get("duration_max_ms")?;
    Ok(TelemetryBackendSummary {
        service: row.try_get("service")?,
        request_count,
        error_count: row.try_get("error_count")?,
        average_duration_ms: average_of(duration_sum_ms, request_count),
        p95_duration_ms: percentile_from_histogram(
            &histogram_from_row(row)?,
            REPORTED_PERCENTILE,
            slowest_duration_ms,
        ),
        slowest_duration_ms,
    })
}

fn route_summary_from_row(row: &PgRow) -> Result<TelemetryRouteSummary, sqlx::Error> {
    let request_count: i64 = row.try_get("request_count")?;
    let error_count: i64 = row.try_get("error_count")?;
    let duration_sum_ms: i64 = row.try_get("duration_sum_ms")?;
    let slowest_duration_ms: i64 = row.try_get("duration_max_ms")?;
    Ok(TelemetryRouteSummary {
        route_pattern: row.try_get("route_pattern")?,
        method: row.try_get("method")?,
        request_count,
        error_count,
        error_rate_percent: percentage_of(error_count, request_count),
        average_duration_ms: average_of(duration_sum_ms, request_count),
        p95_duration_ms: percentile_from_histogram(
            &histogram_from_row(row)?,
            REPORTED_PERCENTILE,
            slowest_duration_ms,
        ),
        slowest_duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Every query that sums a histogram has to sum the same eight columns. The
    // placeholder is what guarantees that; this checks the placeholder is
    // actually replaced rather than shipped verbatim into Postgres.
    #[test]
    fn every_histogram_query_has_its_columns_filled_in() {
        for statement in [
            SELECT_TOTALS_SQL,
            SELECT_VOLUME_POINTS_SQL,
            SELECT_BACKENDS_SQL,
            SELECT_ROUTES_SQL,
        ] {
            let expanded = with_histogram_columns(statement);
            assert!(
                !expanded.contains("{histogram_columns}"),
                "placeholder survived expansion in: {statement}"
            );
            for column_name in HISTOGRAM_COLUMN_NAMES {
                assert!(
                    expanded.contains(column_name),
                    "{column_name} missing from expanded statement"
                );
            }
        }
    }

    // A SUM over a BIGINT column widens to numeric in Postgres, which this
    // service has no decimal type to receive. Every one of them is cast back.
    #[test]
    fn every_sum_is_cast_back_to_a_type_this_service_can_decode() {
        for statement in [
            SELECT_TOTALS_SQL,
            SELECT_STATUS_MIX_SQL,
            SELECT_VOLUME_POINTS_SQL,
            SELECT_ERROR_CODE_TOP_SQL,
            SELECT_WAKE_SIGNALS_SQL,
            SELECT_BACKENDS_SQL,
            SELECT_CACHE_SQL,
            SELECT_ROUTES_SQL,
            HISTOGRAM_SUM_COLUMNS,
        ] {
            for fragment in statement.split("SUM(").skip(1) {
                // An ORDER BY may name a bare SUM(...); only the ones being
                // selected have to be cast.
                if fragment.trim_start().starts_with("count) DESC")
                    || fragment.trim_start().starts_with("request_count) DESC")
                {
                    continue;
                }
                assert!(
                    fragment.contains("::BIGINT"),
                    "an uncast SUM would arrive as numeric: {statement}"
                );
            }
        }
    }

    // Retention that skips the inbox leaves one row per interval per instance
    // forever, which is the table that grows fastest of the five.
    #[test]
    fn retention_covers_every_table_including_the_inbox() {
        let statements = PRUNE_STATEMENTS.join(" ");
        for table in [
            "http_rollups",
            "error_code_rollups",
            "nats_rollups",
            "cache_rollups",
            "inbox_messages",
        ] {
            assert!(
                statements.contains(table),
                "{table} is never pruned and grows without bound"
            );
        }
    }

    // Two instances reporting the same minute are two facts. If any conflict
    // clause assigned instead of adding, one of them would be silently lost.
    #[test]
    fn every_conflict_clause_accumulates_rather_than_overwrites() {
        assert!(UPSERT_HTTP_ROLLUP_SQL.contains("http_rollups.request_count + EXCLUDED.request_count"));
        assert!(UPSERT_HTTP_ROLLUP_SQL.contains("GREATEST(http_rollups.duration_max_ms"));
        assert!(UPSERT_HTTP_ROLLUP_SQL.contains("pair.stored + pair.incoming"));
        assert!(UPSERT_NATS_ROLLUP_SQL.contains("nats_rollups.error_count + EXCLUDED.error_count"));
        assert!(UPSERT_CACHE_ROLLUP_SQL.contains("cache_rollups.hits + EXCLUDED.hits"));
        assert!(
            UPSERT_ERROR_CODE_ROLLUP_SQL.contains("error_code_rollups.count + EXCLUDED.count")
        );
    }

    #[test]
    fn the_inbox_insert_never_raises_on_a_redelivery() {
        assert!(
            INSERT_INBOX_SQL.contains("ON CONFLICT (message_id) DO NOTHING"),
            "a redelivery must report zero rows affected, not fail the transaction"
        );
    }
}
