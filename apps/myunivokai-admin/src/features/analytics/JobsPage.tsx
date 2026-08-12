"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CursorPagination, useCursorPagination } from "@/components/ui/cursor-pagination";
import { analyticsApi } from "./api";
import { FilterSelect } from "./DashboardPage";
import { formatDateTime, formatDuration } from "./format";
import type { JobListFilters, JobProjection, JobStatus } from "./types";

const TABLE_HEADERS = ["Job", "Family", "Status", "Duration", "Error", "Started", "Finished"];

const STATUS_OPTIONS = [
  { label: "Any status", value: "" },
  { label: "Queued", value: "queued" },
  { label: "Processing", value: "processing" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" }
];

export function JobsPage() {
  const [filters, setFilters] = useState<JobListFilters>({ family: "", status: "" });
  const pagination = useCursorPagination();

  // Same reason as the worlds table: a filter change redefines row 1, so an
  // already-taken cursor points into a different result set.
  const { reset } = pagination;
  useEffect(() => {
    reset();
  }, [filters, reset]);

  const jobsQuery = useQuery({
    queryKey: ["analytics", "jobs", filters, pagination.pageSize, pagination.cursor],
    queryFn: () => analyticsApi.jobs(filters, pagination.pageSize, pagination.cursor),
    placeholderData: keepPreviousData
  });

  const jobs = jobsQuery.data?.jobs ?? [];

  return (
    <div>
      <PageHeader
        title="Jobs"
        description="Generation jobs across dna, universe and nature — what failed, why, and how long it took."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Family"
              value={filters.family ?? ""}
              onChange={(value) => setFilters((current) => ({ ...current, family: value as JobListFilters["family"] }))}
              options={[
                { label: "All families", value: "" },
                { label: "Universe", value: "universe" },
                { label: "Nature", value: "nature" }
              ]}
            />
            <FilterSelect
              label="Status"
              value={filters.status ?? ""}
              onChange={(value) => setFilters((current) => ({ ...current, status: value as JobListFilters["status"] }))}
              options={STATUS_OPTIONS}
            />
          </div>
        }
      />
      <Card>
        <CardContent className="pt-2">
          {jobsQuery.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Jobs are unavailable"
              description="analytics-service did not answer. It may be starting up, or the gateway may be unable to reach it."
            />
          ) : jobsQuery.isLoading ? (
            <TableSkeleton columnCount={TABLE_HEADERS.length} headers={TABLE_HEADERS} />
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No jobs match"
              description="Jobs appear here as generations run. Try clearing the filters."
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {TABLE_HEADERS.map((header) => (
                        <TableHead key={header}>{header}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.jobId}>
                        <TableCell className="font-mono text-xs">{job.jobId}</TableCell>
                        <TableCell>
                          {job.family ? (
                            <Badge variant="outline" className="capitalize">
                              {job.family}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <JobStatusBadge status={job.status} />
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">{formatDuration(job.durationMs)}</TableCell>
                        <TableCell className="max-w-[18rem]">
                          {job.errorCode ? (
                            <div className="min-w-0">
                              <p className="font-mono text-xs text-destructive">{job.errorCode}</p>
                              {job.errorMessage ? (
                                <p className="truncate text-xs text-muted-foreground">{job.errorMessage}</p>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {formatDateTime(job.createdAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {formatDateTime(job.completedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-3 lg:hidden">
                {jobs.map((job) => (
                  <JobCard key={job.jobId} job={job} />
                ))}
              </div>

              <CursorPagination
                pagination={pagination}
                nextCursor={jobsQuery.data?.nextCursor}
                loadedCount={jobs.length}
                totalCount={jobsQuery.data?.totalCount ?? 0}
                isFetching={jobsQuery.isFetching}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Exported so the world detail page's job history reads identically to this
// table. A second copy of the status-to-colour mapping would drift.
export function JobStatusBadge({ status }: { status: JobStatus }) {
  const variant = status === "failed" ? "destructive" : status === "completed" ? "outline" : "secondary";
  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}

function JobCard({ job }: { job: JobProjection }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-xs">{job.jobId}</p>
        <JobStatusBadge status={job.status} />
      </div>
      {job.errorCode ? (
        <p className="mt-1.5 font-mono text-xs text-destructive">
          {job.errorCode}
          {job.errorMessage ? <span className="ml-1 text-muted-foreground">{job.errorMessage}</span> : null}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {job.family ? (
          <Badge variant="outline" className="capitalize">
            {job.family}
          </Badge>
        ) : null}
        <Badge variant="ghost">{formatDuration(job.durationMs)}</Badge>
      </div>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{formatDateTime(job.createdAt)}</p>
    </div>
  );
}
