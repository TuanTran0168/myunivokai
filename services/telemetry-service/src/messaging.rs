//! The NATS runtime: one durable JetStream consumer for the rollups, and one
//! queue subscription per query subject.
//!
//! Mirrors `services/analytics-service/internal/messaging/runtime.go`. What is
//! absent is as deliberate as what is here: this service publishes no subject
//! except the caller's reply inbox, and its NATS user grants nothing else.

use std::sync::Arc;

use anyhow::Context;
use futures_util::StreamExt;
use myunivokai_contracts::{
    error_rpc_envelope, success_rpc_envelope, Envelope, HttpRollupData, RpcResponseData,
    TelemetryOverviewQueryData, TelemetryRouteListQueryData, EVENTS_STREAM,
    TELEMETRY_HTTP_ROLLUP_EVENT_SUBJECT, TELEMETRY_OVERVIEW_GET_QUERY_SUBJECT,
    TELEMETRY_ROUTE_LIST_QUERY_SUBJECT,
};
use serde::Serialize;
use time::OffsetDateTime;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::config::Config;
use crate::sinks::otlp::{charts_are_elsewhere_overview, charts_are_elsewhere_routes};
use crate::sinks::{SinkError, TelemetrySink, WriteOutcome};

/// This service's own durable consumer on MYUNIVOKAI_EVENTS. It is one more
/// consumer on a stream that already declares `max_consumers: -1`, and every
/// other consumer on it uses an explicit filter subject, so none of them can
/// see or affect another.
const EVENTS_DURABLE_NAME: &str = "telemetry-events-v1";

/// Unlike analytics-service, the filter is one literal subject rather than a
/// wildcard. This service is the read model for exactly one kind of event, and
/// a wildcard would hand it every world change in the platform to acknowledge
/// and throw away.
const EVENTS_FILTER_SUBJECT: &str = TELEMETRY_HTTP_ROLLUP_EVENT_SUBJECT;

const QUERY_QUEUE_GROUP: &str = "telemetry-service-v1";

/// The job id used when a payload could not be decoded far enough to recover
/// the caller's own. Matches analytics-service's `invalidRequestJobID`.
const INVALID_REQUEST_JOB_ID: &str = "invalid-request";

pub async fn connect(config: &Config) -> anyhow::Result<async_nats::Client> {
    let mut options = async_nats::ConnectOptions::new()
        .name("myunivokai-telemetry")
        .connection_timeout(config.nats_connect_timeout)
        // Matches every other service: reconnect forever rather than exiting.
        // On a scale-to-zero host a broker blip and a cold start look alike,
        // and a process that gives up needs a human where one that waits does
        // not.
        .max_reconnects(None);
    if !config.nats_credentials_file.trim().is_empty() {
        options = async_nats::ConnectOptions::with_credentials_file(
            config.nats_credentials_file.trim().into(),
        )
        .await
        .context("read the NATS credentials file")?
        .name("myunivokai-telemetry")
        .connection_timeout(config.nats_connect_timeout)
        .max_reconnects(None);
    } else if !config.nats_username.trim().is_empty() {
        options = options.user_and_password(
            config.nats_username.clone(),
            config.nats_password.clone(),
        );
    }
    options
        .connect(config.nats_url.clone())
        .await
        .context("connect to NATS")
}

/// Subscribes the durable consumer and returns the task draining it.
///
/// `max_deliver: -1` mirrors dna-service's results consumer, and for the same
/// reason: a write that fails is a transient database problem, and dropping
/// the envelope would leave a permanent hole in the rollups with nothing to
/// replay from once the stream's 7-day retention passes.
pub async fn spawn_rollup_consumer(
    client: async_nats::Client,
    config: Config,
    sink: Arc<dyn TelemetrySink>,
    mut shutdown: watch::Receiver<bool>,
) -> anyhow::Result<JoinHandle<()>> {
    let jetstream = async_nats::jetstream::new(client);
    let stream = jetstream
        .get_stream(EVENTS_STREAM)
        .await
        .with_context(|| format!("open the {EVENTS_STREAM} stream"))?;
    let consumer = stream
        .get_or_create_consumer(
            EVENTS_DURABLE_NAME,
            async_nats::jetstream::consumer::pull::Config {
                durable_name: Some(EVENTS_DURABLE_NAME.to_owned()),
                filter_subject: EVENTS_FILTER_SUBJECT.to_owned(),
                ack_policy: async_nats::jetstream::consumer::AckPolicy::Explicit,
                ack_wait: config.consumer_ack_wait,
                max_deliver: -1,
                max_ack_pending: config.consumer_maximum_ack_pending,
                ..Default::default()
            },
        )
        .await
        .context("create the telemetry durable consumer")?;

    let mut messages = consumer
        .messages()
        .await
        .context("start draining the telemetry consumer")?;

    Ok(tokio::spawn(async move {
        loop {
            let message = tokio::select! {
                _ = shutdown.changed() => break,
                next = messages.next() => match next {
                    Some(Ok(message)) => message,
                    Some(Err(error)) => {
                        tracing::error!(%error, "fetch telemetry rollups");
                        continue;
                    }
                    None => break,
                },
            };
            handle_rollup(&sink, &config, message).await;
        }
        tracing::info!("telemetry rollup consumer stopped");
    }))
}

async fn handle_rollup(
    sink: &Arc<dyn TelemetrySink>,
    config: &Config,
    message: async_nats::jetstream::Message,
) {
    let envelope: Envelope<HttpRollupData> = match serde_json::from_slice(&message.payload) {
        Ok(envelope) => envelope,
        Err(error) => {
            // Acknowledged rather than redelivered forever. A payload this
            // service cannot decode will not become decodable on the fourth
            // attempt, and leaving it unacked blocks every envelope behind it.
            tracing::error!(%error, subject = %message.subject, "discard undecodable telemetry rollup");
            acknowledge(&message).await;
            return;
        }
    };
    if let Err(error) = envelope.data.validate() {
        tracing::error!(%error, subject = %message.subject, "discard invalid telemetry rollup");
        acknowledge(&message).await;
        return;
    }

    match sink.write_rollup(&envelope).await {
        Ok(WriteOutcome::Applied) => {
            tracing::debug!(
                bucket_start = %envelope.data.bucket_start,
                http_buckets = envelope.data.buckets.len(),
                "telemetry rollup stored"
            );
            acknowledge(&message).await;
        }
        Ok(WriteOutcome::AlreadyApplied) => {
            tracing::debug!(
                bucket_start = %envelope.data.bucket_start,
                instance_id = %envelope.data.instance_id,
                "duplicate delivery already stored"
            );
            acknowledge(&message).await;
        }
        Err(error) => {
            // Negatively acknowledged with a delay so the same failure does
            // not spin. The message stays on the stream, which is the whole
            // point of publishing it through JetStream in the first place.
            tracing::error!(%error, "store telemetry rollup");
            if let Err(nak_error) = message
                .ack_with(async_nats::jetstream::AckKind::Nak(Some(
                    config.consumer_retry_delay,
                )))
                .await
            {
                tracing::error!(error = %nak_error, "negatively acknowledge telemetry rollup");
            }
        }
    }
}

async fn acknowledge(message: &async_nats::jetstream::Message) {
    if let Err(error) = message.ack().await {
        tracing::error!(%error, "acknowledge telemetry rollup");
    }
}

/// Subscribes both query subjects. They are queue subscriptions so that two
/// instances of this service during a deploy answer one caller once, rather
/// than racing two replies into the same inbox.
pub async fn spawn_query_responders(
    client: async_nats::Client,
    config: Config,
    sink: Arc<dyn TelemetrySink>,
    shutdown: watch::Receiver<bool>,
) -> anyhow::Result<Vec<JoinHandle<()>>> {
    let overview_handle = spawn_query_responder(
        client.clone(),
        config.clone(),
        sink.clone(),
        shutdown.clone(),
        TELEMETRY_OVERVIEW_GET_QUERY_SUBJECT,
    )
    .await?;
    let routes_handle = spawn_query_responder(
        client,
        config,
        sink,
        shutdown,
        TELEMETRY_ROUTE_LIST_QUERY_SUBJECT,
    )
    .await?;
    Ok(vec![overview_handle, routes_handle])
}

async fn spawn_query_responder(
    client: async_nats::Client,
    config: Config,
    sink: Arc<dyn TelemetrySink>,
    mut shutdown: watch::Receiver<bool>,
    subject: &'static str,
) -> anyhow::Result<JoinHandle<()>> {
    let mut subscription = client
        .queue_subscribe(subject.to_owned(), QUERY_QUEUE_GROUP.to_owned())
        .await
        .with_context(|| format!("subscribe telemetry query {subject}"))?;
    let reply_client = client.clone();

    Ok(tokio::spawn(async move {
        loop {
            let message = tokio::select! {
                _ = shutdown.changed() => break,
                next = subscription.next() => match next {
                    Some(message) => message,
                    None => break,
                },
            };
            let Some(reply_subject) = message.reply.clone() else {
                // Nothing to answer. A query with no reply inbox is a
                // publisher bug, not a request.
                tracing::warn!(subject = %message.subject, "telemetry query carried no reply subject");
                continue;
            };
            let sink = sink.clone();
            let config = config.clone();
            let reply_client = reply_client.clone();
            // Spawned so a slow query cannot hold up the next caller. The
            // deadline inside `answer` bounds how long one of these can live.
            tokio::spawn(async move {
                let payload = answer_query(sink, config, message).await;
                if let Err(error) = reply_client.publish(reply_subject, payload.into()).await {
                    tracing::error!(%error, "publish telemetry query reply");
                }
            });
        }
        tracing::info!(%subject, "telemetry query responder stopped");
    }))
}

/// Builds the reply bytes for one query.
///
/// Dispatch is on the subject rather than on the responder that received it,
/// so that adding a third query subject is one arm here instead of another
/// generic parameter threaded through the spawn path.
async fn answer_query(
    sink: Arc<dyn TelemetrySink>,
    config: Config,
    message: async_nats::Message,
) -> Vec<u8> {
    if message.subject.as_str() == TELEMETRY_ROUTE_LIST_QUERY_SUBJECT {
        return answer_route_list(sink, config, &message.payload).await;
    }
    answer_overview_query(sink, config, &message.payload).await
}

async fn answer_overview_query(
    sink: Arc<dyn TelemetrySink>,
    config: Config,
    payload: &[u8],
) -> Vec<u8> {
    let envelope: Envelope<TelemetryOverviewQueryData> = match decode_query(payload) {
        Ok(envelope) => envelope,
        Err(reply) => return reply,
    };
    let job_id = envelope.job_id.clone();
    let query = envelope.data;
    let outcome = tokio::time::timeout(config.query_timeout, sink.overview(&query)).await;
    match outcome {
        Ok(Ok(response)) => encode_success(&job_id, &response),
        Ok(Err(SinkError::Unsupported(reason))) => {
            // Not an error on the wire. A missing chart has to read as "look
            // elsewhere", never as a broken screen.
            tracing::debug!(%reason, "answering an overview query from a sink that stores nothing");
            encode_success(
                &job_id,
                &charts_are_elsewhere_overview(sink.descriptor(), &query),
            )
        }
        Ok(Err(error)) => encode_query_failure(&job_id, &error),
        Err(_) => encode_timeout(&job_id),
    }
}

async fn answer_route_list(
    sink: Arc<dyn TelemetrySink>,
    config: Config,
    payload: &[u8],
) -> Vec<u8> {
    let envelope: Envelope<TelemetryRouteListQueryData> = match decode_query(payload) {
        Ok(envelope) => envelope,
        Err(reply) => return reply,
    };
    let job_id = envelope.job_id.clone();
    let query = envelope.data;
    let outcome = tokio::time::timeout(config.query_timeout, sink.routes(&query)).await;
    match outcome {
        Ok(Ok(response)) => encode_success(&job_id, &response),
        Ok(Err(SinkError::Unsupported(reason))) => {
            tracing::debug!(%reason, "answering a route query from a sink that stores nothing");
            encode_success(
                &job_id,
                &charts_are_elsewhere_routes(sink.descriptor(), &query),
            )
        }
        Ok(Err(error)) => encode_query_failure(&job_id, &error),
        Err(_) => encode_timeout(&job_id),
    }
}

fn decode_query<DataType: serde::de::DeserializeOwned>(
    payload: &[u8],
) -> Result<Envelope<DataType>, Vec<u8>> {
    match serde_json::from_slice::<Envelope<DataType>>(payload) {
        Ok(envelope) => match envelope.validate() {
            Ok(()) => Ok(envelope),
            Err(reason) => Err(encode_envelope(&error_rpc_envelope(
                INVALID_REQUEST_JOB_ID,
                OffsetDateTime::now_utc(),
                400,
                "INVALID_ENVELOPE",
                reason,
            ))),
        },
        Err(_) => Err(encode_envelope(&error_rpc_envelope(
            INVALID_REQUEST_JOB_ID,
            OffsetDateTime::now_utc(),
            400,
            "INVALID_PAYLOAD",
            "The telemetry query payload could not be decoded.",
        ))),
    }
}

fn encode_success<PayloadType: Serialize>(job_id: &str, payload: &PayloadType) -> Vec<u8> {
    match success_rpc_envelope(job_id, OffsetDateTime::now_utc(), 200, payload) {
        Ok(envelope) => encode_envelope(&envelope),
        Err(error) => {
            tracing::error!(%error, "encode telemetry response");
            encode_envelope(&error_rpc_envelope(
                job_id,
                OffsetDateTime::now_utc(),
                500,
                "INTERNAL_ERROR",
                "The telemetry response could not be encoded.",
            ))
        }
    }
}

fn encode_query_failure(job_id: &str, error: &SinkError) -> Vec<u8> {
    tracing::error!(%error, "answer telemetry query");
    encode_envelope(&error_rpc_envelope(
        job_id,
        OffsetDateTime::now_utc(),
        500,
        "INTERNAL_ERROR",
        "The telemetry query could not be completed.",
    ))
}

fn encode_timeout(job_id: &str) -> Vec<u8> {
    encode_envelope(&error_rpc_envelope(
        job_id,
        OffsetDateTime::now_utc(),
        504,
        "QUERY_TIMEOUT",
        "The telemetry query took too long. Narrow the window.",
    ))
}

/// The last resort. Serialising an RPC envelope cannot realistically fail, and
/// a caller waiting on a reply inbox must receive bytes rather than silence -
/// silence is indistinguishable from a sleeping service and would send the
/// gateway into a wake it does not need.
fn encode_envelope(envelope: &Envelope<RpcResponseData>) -> Vec<u8> {
    serde_json::to_vec(envelope).unwrap_or_else(|_| {
        br#"{"jobId":"invalid-request","timestamp":"1970-01-01T00:00:00Z","data":{"statusCode":500,"error":{"code":"INTERNAL_ERROR","message":"The telemetry response could not be encoded."}}}"#
            .to_vec()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_undecodable_query_is_answered_rather_than_ignored() {
        let reply = decode_query::<TelemetryOverviewQueryData>(b"not json").unwrap_err();
        let decoded: Envelope<RpcResponseData> = serde_json::from_slice(&reply).expect("decode");
        assert_eq!(decoded.data.status_code, 400);
        assert_eq!(decoded.data.error.expect("error").code, "INVALID_PAYLOAD");
    }

    #[test]
    fn an_envelope_without_a_job_id_is_rejected_before_the_sink_is_touched() {
        let payload = br#"{"jobId":"  ","timestamp":"2026-08-13T09:15:00Z","data":{"hours":24}}"#;
        let reply = decode_query::<TelemetryOverviewQueryData>(payload).unwrap_err();
        let decoded: Envelope<RpcResponseData> = serde_json::from_slice(&reply).expect("decode");
        assert_eq!(decoded.data.error.expect("error").code, "INVALID_ENVELOPE");
    }

    #[test]
    fn a_valid_query_decodes_into_its_own_type() {
        let payload = br#"{"jobId":"request-1","timestamp":"2026-08-13T09:15:00Z","data":{"hours":12}}"#;
        let envelope = decode_query::<TelemetryOverviewQueryData>(payload).expect("decode");
        assert_eq!(envelope.job_id, "request-1");
        assert_eq!(envelope.data.hours, 12);
    }

    // The gateway relays whatever reply arrives. A timeout that produced no
    // bytes would look exactly like a sleeping service and send it into a wake
    // it does not need.
    #[test]
    fn a_timeout_still_produces_a_reply() {
        let reply = encode_timeout("request-1");
        let decoded: Envelope<RpcResponseData> = serde_json::from_slice(&reply).expect("decode");
        assert_eq!(decoded.data.status_code, 504);
        assert_eq!(decoded.data.error.expect("error").code, "QUERY_TIMEOUT");
    }
}
