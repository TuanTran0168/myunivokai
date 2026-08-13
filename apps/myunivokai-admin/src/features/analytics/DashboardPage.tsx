"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Gauge, Globe2, Send, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect } from "@/components/ui/filter-select";
import { analyticsApi } from "./api";
import { StatCard } from "./components/StatCard";
import { ActivityChart } from "./components/charts/ActivityChart";
import { DistributionChart } from "./components/charts/DistributionChart";
import { FamilyMixChart } from "./components/charts/FamilyMixChart";
import { TraitRadarChart } from "./components/charts/TraitRadarChart";
import { FAILURE_DISTRIBUTION_CHART_CONFIG } from "./chart-config";
import { formatCount, formatDate, formatDuration, formatPercent } from "./format";
import type { WorldFamily } from "./types";

const RANGE_OPTIONS = [7, 30, 90] as const;
const FAMILY_OPTIONS: { label: string; value: "" | WorldFamily }[] = [
  { label: "All families", value: "" },
  { label: "Universe", value: "universe" },
  { label: "Nature", value: "nature" }
];

export function DashboardPage() {
  const router = useRouter();
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

  // Every distribution bar is a link into the worlds list with that value
  // already selected. The family filter travels with it, because a bar shown
  // under "Nature" that opened an unfiltered list would be answering a
  // different question from the one that was clicked.
  const openWorlds = (parameter: "archetype" | "worldStyle" | "mood", value: string) => {
    const query = new URLSearchParams({ [parameter]: value });
    if (family) {
      query.set("family", family);
    }
    router.push(`/worlds?${query.toString()}`);
  };

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
              [0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-[86px] rounded-2xl" />)
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

          <div className="grid gap-4 lg:grid-cols-2">
            <FamilyMixChart families={overview?.families ?? []} isLoading={overviewQuery.isLoading} />
            <TraitRadarChart
              title="Average trait scores"
              description="Mean across every projected world, not just the selected range."
              scores={overview?.averageTraitScores}
              isLoading={overviewQuery.isLoading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <DistributionChart
              title="Top archetypes"
              description="What the DNA generator is producing most. Select a bar to list those worlds."
              slices={overview?.archetypeTop ?? []}
              isLoading={overviewQuery.isLoading}
              onSelect={(value) => openWorlds("archetype", value)}
            />
            <DistributionChart
              title="World styles"
              description="Preferred style at submission time."
              slices={overview?.worldStyleTop ?? []}
              isLoading={overviewQuery.isLoading}
              onSelect={(value) => openWorlds("worldStyle", value)}
            />
            <DistributionChart
              title="Moods"
              slices={overview?.moodTop ?? []}
              isLoading={overviewQuery.isLoading}
              onSelect={(value) => openWorlds("mood", value)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Failure codes get their own colour and no drill-through: the
                worlds list is not filterable by an error code, and a bar that
                looks clickable but is not is worse than one that never did. */}
            <DistributionChart
              title="Failure codes"
              description="Grouped error codes over the selected range."
              slices={overview?.errorCodeTop ?? []}
              isLoading={overviewQuery.isLoading}
              config={FAILURE_DISTRIBUTION_CHART_CONFIG}
              emptyLabel="No failures in this window."
            />
            <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-1 xl:grid-cols-3">
              <StatCard
                size="compact"
                icon={Boxes}
                label="Multi-variant worlds"
                value={health ? formatPercent(health.multiVariantPercent) : "—"}
              />
              <StatCard
                size="compact"
                icon={Gauge}
                label="Jobs in flight"
                value={health ? formatCount(health.inFlightJobs) : "—"}
              />
              <StatCard
                size="compact"
                icon={Globe2}
                label="Oldest projected world"
                value={overview?.oldestProjectedWorld ? formatDate(overview.oldestProjectedWorld) : "—"}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
