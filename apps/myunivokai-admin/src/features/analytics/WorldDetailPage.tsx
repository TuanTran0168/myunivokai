"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminApiError } from "@/lib/admin-http";
import { analyticsApi } from "./api";
import { JobStatusBadge } from "./JobsPage";
import { formatDateTime, formatDuration } from "./format";
import type { TraitScores } from "./types";

const TRAIT_LABELS: Array<[keyof TraitScores, string]> = [
  ["creativity", "Creativity"],
  ["discipline", "Discipline"],
  ["curiosity", "Curiosity"],
  ["energy", "Energy"],
  ["focus", "Focus"]
];

export function WorldDetailPage({ params }: { params: Promise<{ worldId: string }> }) {
  const { worldId } = use(params);
  const worldQuery = useQuery({
    queryKey: ["analytics", "world", worldId],
    queryFn: () => analyticsApi.world(worldId),
    // A 404 here is a stale link or a world the projection has not caught up
    // to. Neither is fixed by asking again three more times.
    retry: (failureCount, error) =>
      !(error instanceof AdminApiError && error.status === 404) && failureCount < 2
  });

  const detail = worldQuery.data;
  const world = detail?.world;
  const notFound = worldQuery.error instanceof AdminApiError && worldQuery.error.status === 404;

  return (
    <div>
      <PageHeader
        title={world?.nickname ?? (worldQuery.isLoading ? "…" : "World")}
        description={world ? `${world.archetype} · ${world.sceneName}` : undefined}
        action={
          <Link
            href="/worlds"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:border-primary/30 hover:bg-accent/50 hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            All worlds
          </Link>
        }
      />

      {notFound ? (
        <EmptyState
          icon={AlertTriangle}
          title="No such world in the read model"
          description="Either the id is wrong, or the world was created moments ago and the projection has not caught up yet. Analytics is eventually consistent by design."
        />
      ) : worldQuery.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="This world is unavailable"
          description="analytics-service did not answer. It may be starting up, or the gateway may be unable to reach it."
        />
      ) : worldQuery.isLoading || !world || !detail ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="pt-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="capitalize">
                  {world.family}
                </Badge>
                <Badge variant="ghost">{world.worldStyle}</Badge>
                <Badge variant="ghost">{world.mood}</Badge>
                {world.role ? <Badge variant="ghost">{world.role}</Badge> : null}
                {world.isPublished ? <Badge variant="default">Public</Badge> : <Badge variant="secondary">Private</Badge>}
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Variants" value={`${world.selectedVariantNo} of ${world.variantCount} selected`} />
                <Field label="Created" value={formatDateTime(world.worldCreatedAt)} />
                <Field label="Published" value={formatDateTime(world.publishedAt)} />
                <Field label="Projected" value={formatDateTime(world.projectedAt)} />
                <Field label="Revision" value={String(world.revision)} />
                <Field label="World id" value={world.worldId} mono />
                <Field label="Profile id" value={world.profileId} mono />
                <Field label="DNA version id" value={world.dnaVersionId} mono />
                <Field label="Source job id" value={world.sourceJobId} mono />
              </dl>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="pt-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trait scores</p>
                <div className="mt-3 flex flex-col gap-2.5">
                  {TRAIT_LABELS.map(([key, label]) => (
                    <TraitBar key={key} label={label} score={world.traitScores[key]} />
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Favorite colors</p>
                {world.favoriteColors.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">None recorded.</p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {world.favoriteColors.map((color) => (
                      <ColorSwatch key={color} color={color} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="pt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Job history · {detail.jobs.length}
              </p>
              {detail.jobs.length === 0 ? (
                <EmptyState
                  icon={ListChecks}
                  title="No jobs recorded against this world"
                  description="A world projected from an event that predates job tracking has no history here."
                />
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {["Job", "Status", "Error", "Duration", "Created", "Completed"].map((header) => (
                          <TableHead key={header}>{header}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.jobs.map((job) => (
                        <TableRow key={job.jobId}>
                          <TableCell className="font-mono text-xs">{job.jobId}</TableCell>
                          <TableCell>
                            <JobStatusBadge status={job.status} />
                          </TableCell>
                          <TableCell className="max-w-[18rem] truncate text-xs text-muted-foreground">
                            {job.errorCode ? `${job.errorCode}: ${job.errorMessage ?? ""}` : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">{formatDuration(job.durationMs)}</TableCell>
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
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono text-xs text-foreground" : "text-sm text-foreground"}>{value}</dd>
    </div>
  );
}

// Trait scores are 0-100 from the DNA pipeline. The bar is clamped rather than
// trusted: a score outside that range is a bug upstream, and a bar wider than
// its track would hide it behind a layout glitch instead of showing the number.
function TraitBar({ label, score }: { label: string; score: number }) {
  const width = Math.max(0, Math.min(100, score));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-xs tabular-nums text-foreground">{score}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

// The swatch renders the stored string as a CSS colour and prints it beside
// itself. If the value is not a colour the browser paints nothing and the text
// still identifies what was stored — which is the failure an operator needs to
// see, rather than a blank chip.
function ColorSwatch({ color }: { color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border py-1 pl-1 pr-2">
      <span className="size-4 rounded" style={{ backgroundColor: color }} aria-hidden="true" />
      <span className="font-mono text-xs text-muted-foreground">{color}</span>
    </span>
  );
}
