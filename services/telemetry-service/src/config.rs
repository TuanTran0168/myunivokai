//! Configuration, read once at startup and validated before anything connects.
//!
//! Mirrors every Go service's `internal/config`: a real process environment
//! always outranks a dotenv file, so a deployed container is never silently
//! repointed by a file that happened to be baked into the image. `dotenvy`'s
//! non-overriding loader gives that for free - it sets only variables that are
//! currently unset - where the Go services had to snapshot and restore the
//! environment by hand to get the same result.

use std::time::Duration;

use myunivokai_contracts::{TELEMETRY_SINK_OTLP, TELEMETRY_SINK_POSTGRES};

const DEFAULT_HEALTH_PORT: u16 = 8080;
const DEFAULT_DATABASE_MAXIMUM_CONNECTIONS: u32 = 5;
const DEFAULT_NATS_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_QUERY_TIMEOUT: Duration = Duration::from_millis(2500);
const DEFAULT_CONSUMER_ACK_WAIT: Duration = Duration::from_secs(120);
const DEFAULT_CONSUMER_RETRY_DELAY: Duration = Duration::from_secs(2);
const DEFAULT_RETENTION_SWEEP_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const DEFAULT_RETENTION_DAYS: i64 = 90;
const DEFAULT_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(15);

/// consumer_maximum_ack_pending matches every other consumer in the repository.
const DEFAULT_CONSUMER_MAXIMUM_ACK_PENDING: i64 = 1000;

/// Which destination the rollups are written to, chosen once at boot.
///
/// This is `ai.Provider`'s idiom applied to a different axis: one small
/// interface, adapters in their own module, selected by one environment
/// variable read once at startup - rather than a fourth invented version of
/// the same decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SinkName {
    Postgres,
    Otlp,
}

impl SinkName {
    pub fn as_str(self) -> &'static str {
        match self {
            SinkName::Postgres => TELEMETRY_SINK_POSTGRES,
            SinkName::Otlp => TELEMETRY_SINK_OTLP,
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            TELEMETRY_SINK_POSTGRES => Ok(SinkName::Postgres),
            TELEMETRY_SINK_OTLP => Ok(SinkName::Otlp),
            other => Err(format!(
                "TELEMETRY_SINK must be {TELEMETRY_SINK_POSTGRES} or {TELEMETRY_SINK_OTLP}, got {other:?}"
            )),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub app_environment: String,
    pub health_port: u16,
    pub sink: SinkName,

    pub database_url: String,
    pub database_direct_url: String,
    pub database_maximum_connections: u32,

    pub nats_url: String,
    pub nats_username: String,
    pub nats_password: String,
    pub nats_credentials_file: String,
    pub nats_connect_timeout: Duration,

    pub query_timeout: Duration,
    pub consumer_ack_wait: Duration,
    pub consumer_maximum_ack_pending: i64,
    pub consumer_retry_delay: Duration,

    pub retention_days: i64,
    pub retention_sweep_interval: Duration,
    pub shutdown_timeout: Duration,

    pub otlp_endpoint: String,
    /// Where the admin app should send a reader when this sink stores nothing
    /// locally. Empty is legal and means "nobody configured one", which the
    /// screen states plainly rather than rendering a dead link.
    pub dashboard_url: String,
}

impl Config {
    /// Reads the environment and refuses to return a Config that would start a
    /// process unable to do its job.
    ///
    /// Fail-fast is the whole point, and it is the same fail-fast the gateway
    /// gets from building its wake coordinator at startup: a sink selected but
    /// unconfigured must stop the deploy, not become an unexplained no-op at
    /// the one moment somebody looks at the screen.
    pub fn load() -> Result<Self, String> {
        load_environment_files();
        let sink = SinkName::parse(&get("TELEMETRY_SINK", TELEMETRY_SINK_POSTGRES))?;
        let config = Config {
            app_environment: get("APP_ENV", "development"),
            health_port: get_number("PORT", DEFAULT_HEALTH_PORT)?,
            sink,

            database_url: get("DATABASE_URL", ""),
            database_direct_url: get("DATABASE_DIRECT_URL", ""),
            database_maximum_connections: get_number(
                "DATABASE_MAX_CONNS",
                DEFAULT_DATABASE_MAXIMUM_CONNECTIONS,
            )?,

            nats_url: get("NATS_URL", "nats://localhost:4222"),
            nats_username: get("NATS_USERNAME", ""),
            nats_password: get("NATS_PASSWORD", ""),
            nats_credentials_file: get("NATS_CREDENTIALS", ""),
            nats_connect_timeout: get_duration("NATS_CONNECT_TIMEOUT", DEFAULT_NATS_CONNECT_TIMEOUT)?,

            query_timeout: get_duration("NATS_QUERY_TIMEOUT", DEFAULT_QUERY_TIMEOUT)?,
            consumer_ack_wait: get_duration("NATS_ACK_WAIT", DEFAULT_CONSUMER_ACK_WAIT)?,
            consumer_maximum_ack_pending: get_number(
                "NATS_MAX_ACK_PENDING",
                DEFAULT_CONSUMER_MAXIMUM_ACK_PENDING,
            )?,
            consumer_retry_delay: get_duration("NATS_RETRY_DELAY", DEFAULT_CONSUMER_RETRY_DELAY)?,

            retention_days: get_number("TELEMETRY_RETENTION_DAYS", DEFAULT_RETENTION_DAYS)?,
            retention_sweep_interval: get_duration(
                "TELEMETRY_RETENTION_SWEEP_INTERVAL",
                DEFAULT_RETENTION_SWEEP_INTERVAL,
            )?,
            shutdown_timeout: get_duration("SERVICE_SHUTDOWN_TIMEOUT", DEFAULT_SHUTDOWN_TIMEOUT)?,

            otlp_endpoint: get("TELEMETRY_OTLP_ENDPOINT", ""),
            dashboard_url: get("TELEMETRY_DASHBOARD_URL", ""),
        };
        config.validate()?;
        Ok(config)
    }

    /// The migration connection. Neon's pooled endpoint cannot run DDL, which
    /// is why every Go service here carries the same pair of URLs; falling back
    /// to the pooled one keeps a single-URL local setup working.
    pub fn migration_database_url(&self) -> &str {
        if self.database_direct_url.trim().is_empty() {
            &self.database_url
        } else {
            &self.database_direct_url
        }
    }

    fn validate(&self) -> Result<(), String> {
        if self.nats_url.trim().is_empty() {
            return Err("NATS_URL is required".to_owned());
        }
        if self.query_timeout.is_zero()
            || self.consumer_ack_wait.is_zero()
            || self.consumer_retry_delay.is_zero()
            || self.shutdown_timeout.is_zero()
        {
            return Err("NATS and shutdown timing values must be positive".to_owned());
        }
        if self.consumer_maximum_ack_pending <= 0 {
            return Err("NATS_MAX_ACK_PENDING must be positive".to_owned());
        }
        match self.sink {
            SinkName::Postgres => {
                // Only demanded for the sink that actually opens a database.
                // Requiring it unconditionally would make the OTLP-only
                // deployment - which needs no database at all, and is half the
                // reason the switch exists - impossible to configure.
                if self.database_url.trim().is_empty() {
                    return Err("DATABASE_URL is required when TELEMETRY_SINK=postgres".to_owned());
                }
                if self.database_maximum_connections == 0 {
                    return Err("DATABASE_MAX_CONNS must be positive".to_owned());
                }
                if self.retention_days <= 0 {
                    return Err("TELEMETRY_RETENTION_DAYS must be positive".to_owned());
                }
                if self.retention_sweep_interval.is_zero() {
                    return Err("TELEMETRY_RETENTION_SWEEP_INTERVAL must be positive".to_owned());
                }
            }
            SinkName::Otlp => {
                if self.otlp_endpoint.trim().is_empty() {
                    return Err(
                        "TELEMETRY_OTLP_ENDPOINT is required when TELEMETRY_SINK=otlp".to_owned()
                    );
                }
            }
        }
        Ok(())
    }
}

fn load_environment_files() {
    if let Ok(explicit_file) = std::env::var("MYUNIVOKAI_ENV_FILE") {
        if !explicit_file.trim().is_empty() {
            let _ = dotenvy::from_filename(explicit_file.trim());
            return;
        }
    }
    let _ = dotenvy::from_filename(".env");
    let _ = dotenvy::from_filename(".env.local");
}

fn get(key: &str, fallback: &str) -> String {
    match std::env::var(key) {
        Ok(value) if !value.trim().is_empty() => value.trim().to_owned(),
        _ => fallback.to_owned(),
    }
}

/// An unparseable number is an error rather than a silent fallback, unlike the
/// Go services' `getInt`.
///
/// That is a deliberate divergence, not an oversight: `DATABASE_MAX_CONNS=1O`
/// with a letter O in it should stop a deploy, and silently running on the
/// default is exactly the kind of misconfiguration nobody finds until the
/// symptom is somewhere else entirely.
fn get_number<NumberType: std::str::FromStr>(
    key: &str,
    fallback: NumberType,
) -> Result<NumberType, String> {
    match std::env::var(key) {
        Ok(value) if !value.trim().is_empty() => value
            .trim()
            .parse()
            .map_err(|_| format!("{key} must be a number, got {value:?}")),
        _ => Ok(fallback),
    }
}

/// Parses Go's duration spelling ("60s", "2m", "2500ms", "6h") so that one
/// `.env.example` and one `render.yaml` can describe every service in this
/// repository the same way, regardless of which language reads it.
fn get_duration(key: &str, fallback: Duration) -> Result<Duration, String> {
    let raw = match std::env::var(key) {
        Ok(value) if !value.trim().is_empty() => value.trim().to_owned(),
        _ => return Ok(fallback),
    };
    parse_go_duration(&raw).ok_or_else(|| {
        format!("{key} must be a duration such as 500ms, 30s, 5m or 6h, got {raw:?}")
    })
}

fn parse_go_duration(raw: &str) -> Option<Duration> {
    let (digits, unit) = raw.split_at(raw.find(|character: char| character.is_alphabetic())?);
    let amount: u64 = digits.parse().ok()?;
    match unit {
        "ms" => Some(Duration::from_millis(amount)),
        "s" => Some(Duration::from_secs(amount)),
        "m" => Some(Duration::from_secs(amount * 60)),
        "h" => Some(Duration::from_secs(amount * 60 * 60)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_config() -> Config {
        Config {
            app_environment: "test".to_owned(),
            health_port: 8080,
            sink: SinkName::Postgres,
            database_url: "postgres://localhost/myunivokai_telemetry".to_owned(),
            database_direct_url: String::new(),
            database_maximum_connections: 5,
            nats_url: "nats://localhost:4222".to_owned(),
            nats_username: String::new(),
            nats_password: String::new(),
            nats_credentials_file: String::new(),
            nats_connect_timeout: Duration::from_secs(5),
            query_timeout: Duration::from_millis(2500),
            consumer_ack_wait: Duration::from_secs(120),
            consumer_maximum_ack_pending: 1000,
            consumer_retry_delay: Duration::from_secs(2),
            retention_days: 90,
            retention_sweep_interval: Duration::from_secs(21_600),
            shutdown_timeout: Duration::from_secs(15),
            otlp_endpoint: String::new(),
            dashboard_url: String::new(),
        }
    }

    #[test]
    fn go_style_durations_are_understood() {
        assert_eq!(parse_go_duration("2500ms"), Some(Duration::from_millis(2500)));
        assert_eq!(parse_go_duration("30s"), Some(Duration::from_secs(30)));
        assert_eq!(parse_go_duration("2m"), Some(Duration::from_secs(120)));
        assert_eq!(parse_go_duration("6h"), Some(Duration::from_secs(21_600)));
        assert_eq!(parse_go_duration("later"), None);
        assert_eq!(parse_go_duration("30"), None);
    }

    #[test]
    fn an_unknown_sink_name_is_refused_rather_than_defaulted() {
        assert!(SinkName::parse("postgres").is_ok());
        assert!(SinkName::parse("otlp").is_ok());
        assert!(SinkName::parse("prometheus").is_err());
        assert!(SinkName::parse("").is_err());
    }

    #[test]
    fn the_postgres_sink_refuses_to_start_without_a_database() {
        let mut config = base_config();
        assert!(config.validate().is_ok());
        config.database_url = "   ".to_owned();
        assert!(config.validate().is_err());
    }

    // The OTLP-only deployment needs no database at all, and that is half the
    // reason the switch exists. Demanding DATABASE_URL unconditionally would
    // make it impossible to configure.
    #[test]
    fn the_otlp_sink_needs_an_endpoint_but_no_database() {
        let mut config = base_config();
        config.sink = SinkName::Otlp;
        config.database_url = String::new();
        assert!(config.validate().is_err(), "an endpoint is still required");

        config.otlp_endpoint = "https://otlp-gateway.example.net/otlp".to_owned();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn the_pooled_url_is_used_for_migrations_only_when_no_direct_url_exists() {
        let mut config = base_config();
        assert_eq!(config.migration_database_url(), config.database_url);

        config.database_direct_url = "postgres://direct/myunivokai_telemetry".to_owned();
        assert_eq!(
            config.migration_database_url(),
            "postgres://direct/myunivokai_telemetry"
        );
    }
}
