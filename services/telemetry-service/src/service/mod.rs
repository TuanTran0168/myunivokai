//! The application layer: every decision this service makes that is not
//! storage and not transport.
//!
//! It mirrors `services/analytics-service/internal/services` exactly — a type
//! holding a repository, answering the questions the handlers ask, computing
//! nothing the database could compute and everything the database should not.
//! What lives here specifically:
//!
//! - which percentile is reported, and that it is labelled as interpolated
//! - what "error rate" means (5xx, not 4xx) once the repository has counted
//! - how eight separate reads become one overview response
//! - how long data is kept
//!
//! What does not live here: SQL, NATS, HTTP, and the sink switch.

pub mod telemetry;

pub use telemetry::TelemetryService;
