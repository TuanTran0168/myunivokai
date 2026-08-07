"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Gauge, Globe2, Send, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { analyticsApi } from "./api";
import { ActivityChart } from "./ActivityChart";
import { DistributionBars } from "./DistributionBars";
import { StatCard } from "./StatCard";
import { formatCount, formatDate, formatDuration, formatPercent } from "./format";
import type { WorldFamily } from "./types";

const RANGE_OPTIONS = [7, 30, 90] as const;
const FAMILY_OPTIONS: { label: string; value: "" | WorldFamily }[] = [
  { label: "All families", value: "" },
  { label: "Universe", value: "universe" },
  { label: "Nature", value: "nature" }
];

export function DashboardPage() {
  const [days, setDays] = useState<number>(30);
  const [family, setFamily] = useState<"" | WorldFamily>("");

  const overviewQuery = useQuery({
    queryKey: ["analytics", "overview", days, family],
    queryFn: () => analyticsApi.overview(days, family)
  });
  const timeseriesQuery = useQuery({
    queryKey: ["analytics", "timeseries", days, family],
    queryFn: () => analyticsApi.timeseries(days, family)
  });

  const overview = overviewQuery.data;
  const health = overview?.jobHealth;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Read from analytics-service. Eventually consistent — a world appears here seconds after it is created."
        action={
          <div className="flex items-center gap-2">
            <FilterSelect
              label="Family"
              value={family}
              onChange={(value) => setFamily(value as "" | WorldFamily)}
              options={FAMILY_OPTIONS}
            />
            <FilterSelect
              label="Range"
              value={String(days)}
              onChange={(value) => setDays(Number(value))}
              options={RANGE_OPTIONS.map((option) => ({ label: `${option} days`, value: String(option) }))}
            />
          </div>
        }
      />

      {overviewQuery.isError ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={AlertTriangle}
              title="Analytics is unavailable"
              description="analytics-service did not answer. It may be starting up, or the gateway may be unable to reach it."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {overviewQuery.isLoading || !overview || !health ? (
              <>
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-[86px] rounded-2xl" />
                ))}
              </>
            ) : (
              <>
                <StatCard
                  icon={Globe2}
                  label="Worlds"
                  value={formatCount(overview.totalWorlds)}
                  hint={`${formatCount(overview.worldsInWindow)} in the last ${overview.days} days`}
                />
                <StatCard
                  icon={Send}
                  label="Published"
                  value={formatCount(overview.totalPublished)}
                  hint={`${formatPercent(health.publishRatePercent)} of all worlds`}
                />
                <StatCard
                  icon={AlertTriangle}
                  label="Job failure rate"
                  value={formatPercent(health.failureRatePercent)}
                  hint={`${formatCount(health.failedJobs)} of ${formatCount(health.totalJobs)} jobs`}
                  tone={health.failureRatePercent > 0 ? "warning" : "default"}
                />
                <StatCard
                  icon={Timer}
                  label="P95 duration"
                  value={formatDuration(health.p95DurationMs)}
                  hint={`avg ${formatDuration(health.averageDurationMs)} over ${formatCount(health.measuredJobCount)} finished`}
                />
              </>
            )}
          </div>

          <ActivityChart points={timeseriesQuery.data?.points ?? []} isLoading={timeseriesQuery.isLoading} />

          {overview && overview.families.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {overview.families.map((familyTotals) => (
                <Card key={familyTotals.family}>
                  <CardContent className="pt-2">
                    <h2 className="text-sm font-medium capitalize text-foreground">{familyTotals.family}</h2>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <FamilyStat label="Worlds" value={formatCount(familyTotals.worldCount)} />
                      <FamilyStat label="Published" value={formatCount(familyTotals.publishedCount)} />
                      <FamilyStat label="Variants" value={formatCount(familyTotals.variantCount)} />
                      <FamilyStat
                        label="Jobs (window)"
                        value={`${formatCount(familyTotals.jobCount)} · ${formatCount(familyTotals.failedJobCount)} failed`}
                      />
                    </dl>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <DistributionBars
              title="Top archetypes"
              description="What the DNA generator is producing most."
              slices={overview?.archetypeTop ?? []}
            />
            <DistributionBars
              title="World styles"
              description="Preferred style at submission time."
              slices={overview?.worldStyleTop ?? []}
            />
            <DistributionBars
              title="Moods"
              slices={overview?.moodTop ?? []}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <DistributionBars
              title="Failure codes"
              description="Grouped error codes over the selected range."
              slices={overview?.errorCodeTop ?? []}
              emptyLabel="No failures in this window."
            />
            <Card className="lg:col-span-2">
              <CardContent className="pt-2">
                <h2 className="text-sm font-medium text-foreground">Average trait scores</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Mean across every projected world, not just the selected range.
                </p>
                {overview ? (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                    {(
                      [
                        ["Creativity", overview.averageTraitScores.creativity],
                        ["Discipline", overview.averageTraitScores.discipline],
                        ["Curiosity", overview.averageTraitScores.curiosity],
                        ["Energy", overview.averageTraitScores.energy],
                        ["Focus", overview.averageTraitScores.focus]
                      ] as const
                    ).map(([label, score]) => (
                      <div key={label}>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="mt-0.5 font-heading text-lg font-semibold tabular-nums text-foreground">{score}</p>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary/70" style={{ width: `${score}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Skeleton className="mt-4 h-16 rounded-lg" />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCardLite icon={Boxes} label="Multi-variant worlds" value={overview ? formatPercent(overview.jobHealth.multiVariantPercent) : "—"} />
            <StatCardLite icon={Gauge} label="Jobs in flight" value={health ? formatCount(health.inFlightJobs) : "—"} />
            <StatCardLite
              icon={Globe2}
              label="Oldest projected world"
              value={overview?.oldestProjectedWorld ? formatDate(overview.oldestProjectedWorld) : "—"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FamilyStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function StatCardLite({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Globe2;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="pt-2">
        <div className="flex items-center gap-2.5">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 truncate text-sm font-medium tabular-nums text-foreground">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        className="h-8 cursor-pointer rounded-lg border border-border bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-popover text-popover-foreground">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
