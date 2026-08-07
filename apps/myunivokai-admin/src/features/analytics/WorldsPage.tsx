"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Globe2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CursorPagination, useCursorPagination } from "@/components/ui/cursor-pagination";
import { analyticsApi } from "./api";
import { FilterSelect } from "./DashboardPage";
import { formatDateTime } from "./format";
import type { WorldListFilters, WorldProjection } from "./types";

const TABLE_HEADERS = ["Nickname", "Family", "Archetype", "Scene", "Style", "Mood", "Variants", "Published", "Created"];

// The style list mirrors contracts/go's allowedWorldStyles. A style that
// exists in data but not here is still reachable — it just is not offered as
// a one-click filter.
const STYLE_OPTIONS = [
  { label: "All styles", value: "" },
  { label: "Cosmic galaxy", value: "cosmic-galaxy" },
  { label: "Nebula", value: "nebula" },
  { label: "Crystal", value: "crystal" },
  { label: "Aurora", value: "aurora" },
  { label: "Cyber orbit", value: "cyber-orbit" }
];

export function WorldsPage() {
  const [filters, setFilters] = useState<WorldListFilters>({ family: "", worldStyle: "", published: "" });
  const pagination = useCursorPagination();

  // Changing a filter changes what row 1 is, so every cursor already taken
  // points into a different result set. Resetting is not a nicety — resuming
  // from a stale cursor silently skips rows.
  const { reset } = pagination;
  useEffect(() => {
    reset();
  }, [filters, reset]);

  const worldsQuery = useQuery({
    queryKey: ["analytics", "worlds", filters, pagination.pageSize, pagination.cursor],
    queryFn: () => analyticsApi.worlds(filters, pagination.pageSize, pagination.cursor),
    placeholderData: keepPreviousData
  });

  const worlds = worldsQuery.data?.worlds ?? [];

  return (
    <div>
      <PageHeader
        title="Worlds"
        description="Every generated world, newest first, projected from universe and nature events."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Family"
              value={filters.family ?? ""}
              onChange={(value) => setFilters((current) => ({ ...current, family: value as WorldListFilters["family"] }))}
              options={[
                { label: "All families", value: "" },
                { label: "Universe", value: "universe" },
                { label: "Nature", value: "nature" }
              ]}
            />
            <FilterSelect
              label="Style"
              value={filters.worldStyle ?? ""}
              onChange={(value) => setFilters((current) => ({ ...current, worldStyle: value }))}
              options={STYLE_OPTIONS}
            />
            <FilterSelect
              label="Published"
              value={filters.published ?? ""}
              onChange={(value) => setFilters((current) => ({ ...current, published: value as WorldListFilters["published"] }))}
              options={[
                { label: "Any", value: "" },
                { label: "Published", value: "true" },
                { label: "Private", value: "false" }
              ]}
            />
          </div>
        }
      />
      <Card>
        <CardContent className="pt-2">
          {worldsQuery.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Worlds are unavailable"
              description="analytics-service did not answer. It may be starting up, or the gateway may be unable to reach it."
            />
          ) : worldsQuery.isLoading ? (
            <TableSkeleton columnCount={TABLE_HEADERS.length} headers={TABLE_HEADERS} />
          ) : worlds.length === 0 ? (
            <EmptyState
              icon={Globe2}
              title="No worlds match"
              description="Worlds appear here seconds after they are generated. Try clearing the filters."
            />
          ) : (
            <>
              {/* Desktop table */}
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
                    {worlds.map((world) => (
                      <TableRow key={world.worldId}>
                        <TableCell className="text-sm font-medium">{world.nickname}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {world.family}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{world.archetype}</TableCell>
                        <TableCell className="max-w-[16rem] truncate text-sm text-muted-foreground">
                          {world.sceneName}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{world.worldStyle}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{world.mood}</TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {world.selectedVariantNo}/{world.variantCount}
                        </TableCell>
                        <TableCell>
                          {world.isPublished ? (
                            <Badge variant="default">Public</Badge>
                          ) : (
                            <Badge variant="secondary">Private</Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {formatDateTime(world.worldCreatedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Narrow-viewport cards: nine columns do not fit a phone, and a
                  horizontally scrolling table hides the columns that matter. */}
              <div className="flex flex-col gap-3 lg:hidden">
                {worlds.map((world) => (
                  <WorldCard key={world.worldId} world={world} />
                ))}
              </div>

              <CursorPagination
                pagination={pagination}
                nextCursor={worldsQuery.data?.nextCursor}
                loadedCount={worlds.length}
                totalCount={worldsQuery.data?.totalCount ?? 0}
                isFetching={worldsQuery.isFetching}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WorldCard({ world }: { world: WorldProjection }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{world.nickname}</p>
          <p className="truncate text-xs text-muted-foreground">{world.archetype}</p>
        </div>
        {world.isPublished ? <Badge variant="default">Public</Badge> : <Badge variant="secondary">Private</Badge>}
      </div>
      <p className="mt-1.5 truncate text-xs text-muted-foreground">{world.sceneName}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="capitalize">
          {world.family}
        </Badge>
        <Badge variant="ghost">{world.worldStyle}</Badge>
        <Badge variant="ghost">{world.mood}</Badge>
        <Badge variant="ghost">
          {world.selectedVariantNo}/{world.variantCount} variants
        </Badge>
      </div>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{formatDateTime(world.worldCreatedAt)}</p>
    </div>
  );
}
