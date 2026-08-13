// Mirrors contracts/go/contracts_telemetry_rollup.go, which is itself mirrored
// by contracts/rust. Every shape here is computed by telemetry-service and
// relayed unchanged by the gateway — this app renders numbers, it never derives
// them.
//
// This is a separate feature folder from `analytics` on purpose. The two read
// from different services with different data boundaries: analytics answers
// questions about worlds and jobs, telemetry answers questions about the
// platform itself, and merging them here would put one service's outage on the
// other's screen.

// Kept in step with contracts.TelemetryDefaultHours / MaximumHours.
// telemetry-service clamps to the same bounds server-side, so a mismatch here
// degrades the window picker rather than breaking a query.
export const TELEMETRY_WINDOW_OPTIONS = [
  { label: "Last hour", value: 1 },
  { label: "Last 6 hours", value: 6 },
  { label: "Last 24 hours", value: 24 },
  { label: "Last 3 days", value: 72 },
  { label: "Last 7 days", value: 168 }
] as const;

export const DEFAULT_TELEMETRY_HOURS = 24;

// On every telemetry response, not only the ones that fail to answer. The
// screen reads `chartsAvailable` to decide whether to draw charts or a link,
// instead of inferring intent from an empty array — an empty chart and "the
// data lives in Grafana" look identical otherwise, and mean opposite things.
export interface TelemetrySink {
  sink: "postgres" | "otlp";
  chartsAvailable: boolean;
  dashboardUrl?: string;
}

export interface TelemetryVolumePoint {
  bucketStart: string;
  requestCount: number;
  errorCount: number;
  p95DurationMs: number;
}

export interface TelemetryStatusClassCount {
  statusClass: number;
  requestCount: number;
}

export interface TelemetryErrorCodeCount {
  errorCode: string;
  count: number;
}

export interface TelemetryBackendSummary {
  service: string;
  requestCount: number;
  errorCount: number;
  averageDurationMs: number;
  p95DurationMs: number;
  slowestDurationMs: number;
}

export interface TelemetryCacheSummary {
  namespace: string;
  hits: number;
  misses: number;
  hitRatePercent: number;
}

export interface TelemetryOverview extends TelemetrySink {
  hours: number;
  generatedAt: string;
  totalRequests: number;
  // 5xx only. A 404 or a validation failure is the client's problem, and
  // folding it in would produce an error rate that never goes down; statusMix
  // carries the rest so nothing is hidden.
  errorRequests: number;
  errorRatePercent: number;
  averageDurationMs: number;
  p95DurationMs: number;
  slowestDurationMs: number;
  // Always true when charts are available. The screen is required to render
  // this qualification next to the number: a p95 that looks exact and is not
  // is worse than no p95.
  percentileIsInterpolated: boolean;
  statusMix: TelemetryStatusClassCount[];
  volumePoints: TelemetryVolumePoint[];
  errorCodeTop: TelemetryErrorCodeCount[];
  backends: TelemetryBackendSummary[];
  cache: TelemetryCacheSummary[];
  wakeSignals: TelemetryVolumePoint[];
  // What actually exists in the store, which is not always what was asked for.
  // A service asleep for a week has no data for most of a 24-hour window, and
  // a chart that does not say so reads as "no traffic" rather than "no data".
  oldestBucketStart?: string;
}

export interface TelemetryRouteSummary {
  routePattern: string;
  method: string;
  requestCount: number;
  errorCount: number;
  errorRatePercent: number;
  averageDurationMs: number;
  p95DurationMs: number;
  slowestDurationMs: number;
}

export interface TelemetryRouteList extends TelemetrySink {
  hours: number;
  generatedAt: string;
  percentileIsInterpolated: boolean;
  routes: TelemetryRouteSummary[];
}
