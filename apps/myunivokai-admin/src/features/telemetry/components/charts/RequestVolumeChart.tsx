"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CHART_CURSOR_FILL,
  CHART_GRID_STROKE,
  CHART_TICK,
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartTooltipContent,
  useChartSeriesToggle
} from "@/components/ui/chart";
import { formatBucketInstant, formatBucketTime, formatWindow } from "../../format";
import type { TelemetryVolumePoint } from "../../types";

const VOLUME_CHART_CONFIG: ChartConfig = {
  requestCount: { label: "Requests", color: "var(--chart-1)" },
  errorCount: { label: "5xx", color: "var(--chart-5)" }
};

// Requests per minute, with server errors stacked underneath.
//
// Buckets are one minute wide, which is why the axis shows clock time rather
// than a date: a 24-hour window is 1440 points, and a date on every tick is
// unreadable. The tooltip carries the full instant.
export function RequestVolumeChart({
  points,
  hours,
  isLoading = false
}: {
  points: TelemetryVolumePoint[];
  hours: number;
  isLoading?: boolean;
}) {
  const { hiddenSeries, toggleSeries } = useChartSeriesToggle();
  const hasTraffic = points.some((point) => point.requestCount > 0);

  return (
    <SectionCard
      title={`Requests per minute · ${formatWindow(hours)}`}
      description="One point per rollup interval. The gateway aggregates in memory and publishes one summary per minute, so this is a complete count rather than a sample."
      action={<ChartLegend config={VOLUME_CHART_CONFIG} hiddenSeries={hiddenSeries} onToggle={toggleSeries} />}
    >
      {isLoading ? (
        <Skeleton className="mt-4 h-[220px] rounded-lg" />
      ) : !hasTraffic ? (
        <p className="mt-4 text-xs text-muted-foreground">
          No rollup covers this window. Either the gateway served nothing, or telemetry has not been switched on for
          it — TELEMETRY_ENABLED is off by default.
        </p>
      ) : (
        <ChartContainer config={VOLUME_CHART_CONFIG} height={220} className="mt-4">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="bucketStart"
              tickLine={false}
              axisLine={false}
              tick={CHART_TICK}
              minTickGap={40}
              tickFormatter={formatBucketTime}
            />
            <YAxis tickLine={false} axisLine={false} tick={CHART_TICK} allowDecimals={false} width={44} />
            <Tooltip
              cursor={{ fill: CHART_CURSOR_FILL }}
              content={<ChartTooltipContent config={VOLUME_CHART_CONFIG} labelFormatter={formatBucketInstant} />}
            />
            {!hiddenSeries.has("requestCount") ? (
              <Area
                type="monotone"
                dataKey="requestCount"
                stroke={VOLUME_CHART_CONFIG.requestCount.color}
                fill={VOLUME_CHART_CONFIG.requestCount.color}
                fillOpacity={0.18}
                strokeWidth={2}
                animationDuration={400}
              />
            ) : null}
            {!hiddenSeries.has("errorCount") ? (
              <Area
                type="monotone"
                dataKey="errorCount"
                stroke={VOLUME_CHART_CONFIG.errorCount.color}
                fill={VOLUME_CHART_CONFIG.errorCount.color}
                fillOpacity={0.28}
                strokeWidth={2}
                animationDuration={400}
              />
            ) : null}
          </AreaChart>
        </ChartContainer>
      )}
    </SectionCard>
  );
}
