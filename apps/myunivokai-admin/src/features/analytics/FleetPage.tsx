"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, MoonStar, Power, Server, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CursorPagination, useCursorPagination } from "@/components/ui/cursor-pagination";
import { analyticsApi } from "./api";
import { FilterSelect } from "./DashboardPage";
import { StatCard } from "./StatCard";
import { formatCount, formatDateTime, formatDuration } from "./format";
import type { ServiceStartRecord, ServiceWakeStats } from "./types";

const TABLE_HEADERS = ["Service", "Version", "Instance", "Boot time", "Started"];

const WAKE_STATS_DAYS = 7;

export function FleetPage() {
  const [service, setService] = useState("");
  const pagination = useCursorPagination();

  // Same reason as the worlds table: a cursor names a position in one
  // particular result set, so changing the filter invalidates every cursor
  // already taken.
  const { reset } = pagination;
  useEffect(() => {
    reset();
  }, [service, reset]);

  const wakeQuery = useQuery({
    queryKey: ["analytics", "wake-stats", WAKE_STATS_DAYS],
    queryFn: () => analyticsApi.wakeStats(WAKE_STATS_DAYS)
  });
  const startsQuery = useQuery({
    queryKey: ["analytics", "service-starts", service, pagination.pageSize, pagination.cursor],
    queryFn: () => analyticsApi.serviceStarts(service, pagination.pageSize, pagination.cursor),
    placeholderData: keepPreviousData
  });

  const wake = wakeQuery.data;
  const starts = startsQuery.data?.starts ?? [];
  const strandedServices = wake?.services.filter((entry) => entry.consecutiveFailedWakes > 0) ?? [];

  // The service filter is built from what the fleet actually reports rather
  // than from a hardcoded list, so a service added later appears here without
  // anyone remembering to edit this file.
  const serviceOptions = [
    { label: "All services", value: "" },
    ...(wake?.services ?? []).map((entry) => ({ label: entry.service, value: entry.service }))
  ];

  return (
    <div>
      <PageHeader
        title="Fleet"
        description="Which services have restarted, and which ones the gateway has been unable to wake."
        action={
          <FilterSelect label="Service" value={service} onChange={setService} options={serviceOptions} />
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Power}
          label="Wake platform"
          value={wake?.platform.name ?? "—"}
          hint={wake ? `${wake.platform.wakeableServiceCount} service(s) wakeable` : undefined}
        />
        <StatCard
          icon={MoonStar}
          label={`Wakes sent · ${WAKE_STATS_DAYS}d`}
          value={wake ? formatCount(wake.services.reduce((total, entry) => total + entry.totalWakes, 0)) : "—"}
          hint={wake ? `retry hint ${wake.platform.retryAfterSeconds}s` : undefined}
        />
        <StatCard
          icon={TriangleAlert}
          label="Services not answering"
          value={wake ? String(strandedServices.length) : "—"}
          hint={strandedServices.map((entry) => entry.service).join(", ") || "all answering"}
          tone={strandedServices.length > 0 ? "warning" : "default"}
        />
        <StatCard
          icon={Server}
          label="Restarts recorded"
          value={startsQuery.data ? formatCount(startsQuery.data.totalCount) : "—"}
          hint={service ? `filtered to ${service}` : "across every service"}
        />
      </div>

      <Card className="mt-4">
        <CardContent className="pt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Wake status · last {WAKE_STATS_DAYS} days
          </p>
          {wakeQuery.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Wake statistics are unavailable"
              description="The gateway could not read them. They live in Redis, so this is a gateway-side dependency, not analytics-service."
            />
          ) : wakeQuery.isLoading ? (
            <div className="mt-3 flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {(wake?.services ?? []).map((entry) => (
                <WakeRow key={entry.service} stats={entry} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="pt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Restart history</p>
          {startsQuery.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Restart history is unavailable"
              description="analytics-service did not answer. It may be starting up, or the gateway may be unable to reach it."
            />
          ) : startsQuery.isLoading ? (
            <TableSkeleton columnCount={TABLE_HEADERS.length} headers={TABLE_HEADERS} />
          ) : starts.length === 0 ? (
            <EmptyState
              icon={Server}
              title="No restarts recorded"
              description="Every service announces its own boot. An empty list means nothing has started since this table was created."
            />
          ) : (
            <>
              <div className="mt-3 hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {TABLE_HEADERS.map((header) => (
                        <TableHead key={header}>{header}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {starts.map((start) => (
                      <TableRow key={`${start.instanceId}-${start.startedAt}`}>
                        <TableCell className="text-sm font-medium">{start.service}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{start.version || "—"}</TableCell>
                        <TableCell className="max-w-[14rem] truncate font-mono text-xs text-muted-foreground">
                          {start.instanceId}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {formatDuration(start.bootDurationMs)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {formatDateTime(start.startedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-3 flex flex-col gap-3 lg:hidden">
                {starts.map((start) => (
                  <StartCard key={`${start.instanceId}-${start.startedAt}`} start={start} />
                ))}
              </div>

              <CursorPagination
                pagination={pagination}
                nextCursor={startsQuery.data?.nextCursor}
                loadedCount={starts.length}
                totalCount={startsQuery.data?.totalCount ?? 0}
                isFetching={startsQuery.isFetching}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// A service that is not wakeable reports a flat zero for reasons that have
// nothing to do with its health, so it is labelled rather than scored. Without
// that distinction "0 wakes" reads as "never slept" when it means "never
// covered".
function WakeRow({ stats }: { stats: ServiceWakeStats }) {
  const stranded = stats.consecutiveFailedWakes > 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{stats.service}</p>
        <p className="truncate text-xs text-muted-foreground">Last seen {formatDateTime(stats.lastSeenAt ?? undefined)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {stats.wakeable ? (
          <Badge variant="ghost">{formatCount(stats.totalWakes)} wakes</Badge>
        ) : (
          <Badge variant="secondary">not wakeable</Badge>
        )}
        {stranded ? (
          <Badge variant="destructive">{stats.consecutiveFailedWakes} failed in a row</Badge>
        ) : (
          <Badge variant="outline">answering</Badge>
        )}
      </div>
    </div>
  );
}

function StartCard({ start }: { start: ServiceStartRecord }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-medium">{start.service}</p>
        <Badge variant="ghost">{start.version || "—"}</Badge>
      </div>
      <p className="mt-1.5 truncate font-mono text-xs text-muted-foreground">{start.instanceId}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="ghost">boot {formatDuration(start.bootDurationMs)}</Badge>
      </div>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{formatDateTime(start.startedAt)}</p>
    </div>
  );
}
