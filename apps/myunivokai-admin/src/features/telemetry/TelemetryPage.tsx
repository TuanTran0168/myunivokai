"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Database, Gauge, MoonStar, Route, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect } from "@/components/ui/filter-select";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { StatCard } from "@/features/analytics/components/StatCard";
import { formatCount, formatDateTime, formatDuration, formatPercent } from "@/features/analytics/format";
import { telemetryApi } from "./api";
import { BackendLatencyList } from "./components/BackendLatencyList";
import { CacheHitRateList } from "./components/CacheHitRateList";
import { ROUTE_TABLE_HEADERS, RoutesTable } from "./components/RoutesTable";
import { SinkNotice } from "./components/SinkNotice";
import { RequestVolumeChart } from "./components/charts/RequestVolumeChart";
import { formatStatusClass, formatWindow } from "./format";
import { DEFAULT_TELEMETRY_HOURS, TELEMETRY_WINDOW_OPTIONS } from "./types";

// The operational screen: what the platform itself is doing, read from
// telemetry-service. Deliberately separate from Fleet, which answers a
// different question (which processes restarted, which ones the gateway could
// not wake) from a different service.
export function TelemetryPage() {
  const [hours, setHours] = useState(DEFAULT_TELEMETRY_HOURS);

  const overviewQuery = useQuery({
    queryKey: ["telemetry", "overview", hours],
    queryFn: () => telemetryApi.overview(hours),
    placeholderData: keepPreviousData
  });
  const routesQuery = useQuery({
    queryKey: ["telemetry", "routes", hours],
    queryFn: () => telemetryApi.routes(hours),
    placeholderData: keepPreviousData
  });

  const overview = overviewQuery.data;
  const routes = routesQuery.data?.routes ?? [];
  // One flag decides the whole screen. With TELEMETRY_SINK=otlp every array
  // below is legitimately empty, and empty charts would read as "the platform
  // served no traffic" rather than "the data is in Grafana" — opposite
  // conclusions, and only one of them sends somebody to the right place.
  const chartsAvailable = overview?.chartsAvailable ?? true;

  const windowOptions = TELEMETRY_WINDOW_OPTIONS.map((option) => ({
    label: option.label,
    value: String(option.value)
  }));

  return (
    <div>
      <PageHeader
        title="Telemetry"
        description="What the platform itself is doing: request volume, where the time goes, and whether the caches earn their keep."
        action={
          <FilterSelect
            label="Window"
            value={String(hours)}
            onChange={(value) => setHours(Number(value) || DEFAULT_TELEMETRY_HOURS)}
            options={windowOptions}
          />
        }
      />

      {overviewQuery.isError ? (
        <Card>
          <CardContent className="pt-2">
            <EmptyState
              icon={AlertTriangle}
              title="Telemetry is unavailable"
              description="telemetry-service did not answer. It may be starting up — the gateway wakes it on demand, so a retry in a moment usually succeeds."
            />
          </CardContent>
        </Card>
      ) : !chartsAvailable && overview ? (
        <Card>
          <CardContent className="pt-2">
            <SinkNotice sink={overview} />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Activity}
              label={`Requests · ${formatWindow(hours)}`}
              value={overview ? formatCount(overview.totalRequests) : "—"}
              hint={
                overview?.oldestBucketStart
                  ? `data from ${formatDateTime(overview.oldestBucketStart)}`
                  : "no rollup stored yet"
              }
            />
            <StatCard
              icon={TriangleAlert}
              label="Server error rate"
              value={overview ? formatPercent(overview.errorRatePercent) : "—"}
              hint={overview ? `${formatCount(overview.errorRequests)} responses in the 5xx class` : undefined}
              tone={overview && overview.errorRatePercent > 0 ? "warning" : "default"}
            />
            <StatCard
              icon={Gauge}
              label="p95 response time"
              value={overview ? formatDuration(overview.p95DurationMs) : "—"}
              // The qualification is on the card, not in a tooltip. A p95 that
              // looks exact and is not is worse than no p95, and nobody opens
              // the tooltip.
              hint={
                overview?.percentileIsInterpolated
                  ? `interpolated across bucket edges · slowest ${formatDuration(overview.slowestDurationMs)}`
                  : undefined
              }
            />
            <StatCard
              icon={Route}
              label="Routes hit"
              value={routesQuery.data ? formatCount(routes.length) : "—"}
              hint={overview ? `average ${formatDuration(overview.averageDurationMs)}` : undefined}
            />
          </div>

          <div className="mt-4 flex flex-col gap-4">
            <RequestVolumeChart
              points={overview?.volumePoints ?? []}
              hours={hours}
              isLoading={overviewQuery.isLoading}
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard
                title="Status mix"
                description="Every response the gateway sent, by status class. 4xx is the client's problem and is kept out of the error rate above, not hidden."
              >
                {(overview?.statusMix ?? []).length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">Nothing recorded in this window.</p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {(overview?.statusMix ?? []).map((slice) => (
                      <div key={slice.statusClass} className="flex items-baseline justify-between gap-3">
                        <p className="text-sm text-foreground">{formatStatusClass(slice.statusClass)}</p>
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatCount(slice.requestCount)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="Error codes"
                description="The gateway's own codes, busiest first. SERVICE_WAKING here is a cold start, not a fault."
              >
                {(overview?.errorCodeTop ?? []).length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No request produced an error body in this window.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {(overview?.errorCodeTop ?? []).map((entry) => (
                      <div key={entry.errorCode} className="flex items-baseline justify-between gap-3">
                        <p className="font-mono text-xs text-foreground">{entry.errorCode}</p>
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatCount(entry.count)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard
                title="Backend round trips"
                description="How long each service took to answer, which the HTTP route alone cannot tell apart: /api/{family}/worlds reaches universe or nature depending on the family."
              >
                {(overview?.backends ?? []).length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No request reached a backend service in this window.
                  </p>
                ) : (
                  <BackendLatencyList backends={overview?.backends ?? []} />
                )}
              </SectionCard>

              <SectionCard
                title="Cache hit rate"
                description="The three Redis namespaces. A Redis outage counts as neither a hit nor a miss, so a falling denominator is an outage rather than a cold cache."
              >
                {(overview?.cache ?? []).length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">No cache lookup happened in this window.</p>
                ) : (
                  <CacheHitRateList cache={overview?.cache ?? []} />
                )}
              </SectionCard>
            </div>

            <SectionCard
              title="Wake signals"
              description="How often the gateway answered SERVICE_WAKING. This is an approximation of the wake-conversion rate joined on time proximity, not a per-request causal trace — it says a wake was signalled, not that the retry succeeded."
            >
              {(overview?.wakeSignals ?? []).length === 0 ? (
                <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <MoonStar className="size-3.5" />
                  No request found a sleeping service in this window.
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-1.5">
                  {(overview?.wakeSignals ?? []).map((point) => (
                    <div key={point.bucketStart} className="flex items-baseline justify-between gap-3">
                      <p className="text-xs text-muted-foreground">{formatDateTime(point.bucketStart)}</p>
                      <p className="font-mono text-xs tabular-nums text-foreground">
                        {formatCount(point.requestCount)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Per route"
              description="One row per chi route template and method, busiest first. A world id never appears here — the template is the key, which is what keeps this table bounded by the route count rather than by traffic."
            >
              {routesQuery.isError ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="The route table is unavailable"
                  description="telemetry-service answered the overview but not this query. Narrowing the window is the usual fix."
                />
              ) : routesQuery.isLoading ? (
                <div className="mt-3">
                  <TableSkeleton columnCount={ROUTE_TABLE_HEADERS.length} headers={ROUTE_TABLE_HEADERS} />
                </div>
              ) : routes.length === 0 ? (
                <EmptyState
                  icon={Database}
                  title="No route was hit in this window"
                  description="Either nothing reached the gateway, or TELEMETRY_ENABLED is off — it is off by default, and with it off nothing is ever published."
                />
              ) : (
                <RoutesTable routes={routes} />
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
