//! The health server.
//!
//! It exists for one reason and it is not monitoring: a Render free instance
//! wakes only on inbound HTTP, and this service is otherwise a pure NATS
//! consumer that receives none. The port is bound before the messaging runtime
//! starts so a cold start has something to answer while the rest of the
//! process is still connecting - `/healthz` is a START signal, not a readiness
//! signal, exactly as
//! notes/vision/service-wake-mechanism.md#healthz-is-a-start-signal-not-a-readiness-signal
//! says. Reporting readiness here would make the gateway's wake wait for a
//! database connection that has nothing to do with whether the instance is up.

use axum::routing::get;
use axum::Router;
use tokio::sync::watch;

pub async fn serve(port: u16, mut shutdown: watch::Receiver<bool>) -> anyhow::Result<()> {
    let router = Router::new().route("/healthz", get(|| async { "ok" }));
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!(port, "telemetry health server listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            let _ = shutdown.changed().await;
        })
        .await?;
    Ok(())
}
