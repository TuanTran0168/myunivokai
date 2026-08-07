"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { TimeseriesPoint } from "./types";

const CHART_HEIGHT = 120;

// A daily bar chart over at most 90 points, drawn as plain SVG.
//
// This is deliberately not recharts. The library is ~500 KB, needs a client
// wrapper and a ResponsiveContainer to size at all, and would be the admin
// app's first charting dependency — for a chart with no axes, no zoom and no
// legend. Everything below is CSS variables and rectangles, so it themes with
// the rest of the app for free. Revisit if a screen ever needs real axes,
// brushing or tooltips that follow the cursor.
export function ActivityChart({
  points,
  isLoading
}: {
  points: TimeseriesPoint[];
  isLoading: boolean;
}) {
  const tallestDay = points.reduce((tallest, point) => Math.max(tallest, point.worldCount, point.jobCount), 0);
  const barSlot = points.length === 0 ? 0 : 100 / points.length;

  return (
    <Card>
      <CardContent className="pt-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Daily activity</h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-xs bg-primary/70" />
              Worlds
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-xs bg-destructive/70" />
              Failed jobs
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-4 h-[120px] animate-pulse rounded-lg bg-muted" />
        ) : tallestDay === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">No activity recorded in this window yet.</p>
        ) : (
          <>
            <svg
              className="mt-4 w-full"
              height={CHART_HEIGHT}
              viewBox={`0 0 100 ${CHART_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Worlds created and failed jobs per day over the last ${points.length} days`}
            >
              {points.map((point, index) => {
                const worldHeight = (point.worldCount / tallestDay) * CHART_HEIGHT;
                const failedHeight = (point.failedJobCount / tallestDay) * CHART_HEIGHT;
                return (
                  <g key={point.day}>
                    <rect
                      x={index * barSlot + barSlot * 0.15}
                      y={CHART_HEIGHT - worldHeight}
                      width={barSlot * 0.7}
                      height={worldHeight}
                      className="fill-primary/70"
                    />
                    {failedHeight > 0 ? (
                      <rect
                        x={index * barSlot + barSlot * 0.15}
                        y={CHART_HEIGHT - failedHeight}
                        width={barSlot * 0.7}
                        height={failedHeight}
                        className="fill-destructive/70"
                      />
                    ) : null}
                  </g>
                );
              })}
            </svg>
            <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
              <span>{formatDay(points[0]?.day)}</span>
              <span>{formatDay(points[points.length - 1]?.day)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function formatDay(day?: string): string {
  if (!day) {
    return "";
  }
  return new Date(day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
