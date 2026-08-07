import { Card, CardContent } from "@/components/ui/card";
import type { DistributionSlice } from "./types";

// A distribution of at most eight bars does not need a charting library: a
// flex row with a percentage width is fewer bytes than the import statement
// would be, themes correctly with no wrapper, and has no SSR caveat. Reach
// for a real chart library when a screen needs axes, tooltips or zoom.
export function DistributionBars({
  title,
  description,
  slices,
  emptyLabel = "No data in this window."
}: {
  title: string;
  description?: string;
  slices: DistributionSlice[];
  emptyLabel?: string;
}) {
  const largestCount = slices.reduce((largest, slice) => Math.max(largest, slice.count), 0);

  return (
    <Card>
      <CardContent className="pt-2">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        {slices.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2.5">
            {slices.map((slice) => (
              <li key={slice.value}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-xs text-foreground">{slice.value}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{slice.count}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${largestCount === 0 ? 0 : (slice.count / largestCount) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
