//! telemetry-service — the one process in this repository that is not written
//! in Go.
//!
//! It consumes one aggregated rollup envelope per minute from the gateway,
//! stores it through whichever sink is configured, and answers admin queries
//! over the same one it just wrote. It never sees a raw per-request event and
//! never talks to any service but NATS.
//!
//! Why Rust, and why this service in particular, is answered in
//! notes/vision/rust-adoption-research.md and settled in
//! notes/vision/telemetry-service-plan.md. The short version: it is new, off
//! the product's critical path, has a contract shape this repository already
//! has five examples of, and does sustained aggregation rather than CRUD
//! wearing a new syntax.

mod config;
mod health;
mod messaging;
mod retention;
mod sinks;

use std::sync::Arc;

use config::{Config, SinkName};
use sinks::otlp::OtlpSink;
use sinks::postgres::PostgresSink;
use sinks::TelemetrySink;
use tokio::sync::watch;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    initialise_tracing();

    let config = match Config::load() {
        Ok(config) => config,
        // Deliberately fatal, the same way every Go service here refuses to
        // start on an unusable configuration. A telemetry service that starts
        // with the wrong sink looks identical to one that is working right up
        // until somebody opens the screen and finds nothing.
        Err(reason) => anyhow::bail!("load telemetry service configuration: {reason}"),
    };
    tracing::info!(
        sink = config.sink.as_str(),
        environment = %config.app_environment,
        "telemetry service starting"
    );

    let (shutdown_sender, shutdown_receiver) = watch::channel(false);

    // Bound before anything else connects, so a cold start has an inbound HTTP
    // target while the database and broker are still being reached.
    let health_handle = tokio::spawn({
        let receiver = shutdown_receiver.clone();
        let port = config.health_port;
        async move {
            if let Err(error) = health::serve(port, receiver).await {
                tracing::error!(%error, "telemetry health server failed");
            }
        }
    });

    let active_sink = build_sink(&config).await?;
    let sink = active_sink.shared();

    let client = messaging::connect(&config).await?;
    let consumer_handle = messaging::spawn_rollup_consumer(
        client.clone(),
        config.clone(),
        sink.clone(),
        shutdown_receiver.clone(),
    )
    .await?;
    let mut query_handles = messaging::spawn_query_responders(
        client.clone(),
        config.clone(),
        sink.clone(),
        shutdown_receiver.clone(),
    )
    .await?;
    let retention_handle = retention::spawn(config.clone(), sink.clone(), shutdown_receiver);

    tracing::info!("telemetry service ready");
    wait_for_shutdown_signal().await;
    tracing::info!("telemetry service stopping");

    let _ = shutdown_sender.send(true);
    let mut handles = vec![health_handle, consumer_handle, retention_handle];
    handles.append(&mut query_handles);
    // Bounded, because a task blocked on an unreachable broker must not turn a
    // stop into a kill: the host sends SIGKILL after its own grace period, and
    // exiting cleanly first is the difference between a clean consumer
    // checkpoint and a redelivery on the next boot.
    let _ = tokio::time::timeout(config.shutdown_timeout, async {
        for handle in handles {
            let _ = handle.await;
        }
    })
    .await;
    active_sink.close().await;
    client.flush().await.ok();
    tracing::info!("telemetry service stopped");
    Ok(())
}

/// The concrete sink this process built, kept alongside the trait object the
/// rest of the service uses.
///
/// Shutting a sink down is not part of `TelemetrySink` because only one of the
/// two has anything to do: the OTLP exporter holds metrics that have not been
/// pushed yet, and losing them would mean the last envelope this process
/// acknowledged never reached Grafana. Adding a no-op `close` to the trait so
/// the two look alike would hide that asymmetry rather than describe it, and
/// nothing else in the service is allowed to know which sink it holds.
enum ActiveSink {
    Postgres(Arc<PostgresSink>),
    Otlp(Arc<OtlpSink>),
}

impl ActiveSink {
    fn shared(&self) -> Arc<dyn TelemetrySink> {
        match self {
            ActiveSink::Postgres(sink) => sink.clone(),
            ActiveSink::Otlp(sink) => sink.clone(),
        }
    }

    async fn close(&self) {
        match self {
            ActiveSink::Postgres(sink) => sink.close().await,
            ActiveSink::Otlp(sink) => sink.close(),
        }
    }
}

/// The switch, read once, exactly where `AI_PROVIDER` and
/// `SERVICE_WAKE_PLATFORM` are read in their own services. Everything past
/// this line is written against the trait and never against a concrete sink.
async fn build_sink(config: &Config) -> anyhow::Result<ActiveSink> {
    match config.sink {
        SinkName::Postgres => {
            // Migrations run before the pool that serves traffic is opened, so
            // a schema change that fails stops the process instead of
            // producing a service that answers every query with an error.
            sinks::postgres::run_migrations(config).await?;
            tracing::info!("telemetry database migrations complete");
            Ok(ActiveSink::Postgres(Arc::new(
                PostgresSink::connect(config).await?,
            )))
        }
        SinkName::Otlp => Ok(ActiveSink::Otlp(Arc::new(OtlpSink::connect(config)?))),
    }
}

async fn wait_for_shutdown_signal() {
    let interrupt = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut terminate =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(signal) => signal,
                Err(error) => {
                    tracing::error!(%error, "install the SIGTERM handler");
                    let _ = interrupt.await;
                    return;
                }
            };
        tokio::select! {
            _ = interrupt => {}
            _ = terminate.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = interrupt.await;
    }
}

/// Structured JSON logs, matching what zerolog emits in every Go service here,
/// so one log drain reads the whole fleet the same way.
fn initialise_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_current_span(false)
        .init();
}
