"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { auditApi } from "./api";

export function AuditPage() {
  const auditQuery = useInfiniteQuery({
    queryKey: ["audit"],
    queryFn: ({ pageParam }: { pageParam?: string }) => auditApi.list(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor
  });

  const events = auditQuery.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <div>
      <PageHeader title="Audit log" description="Every login, failed login, role change and admin mutation, newest first." />
      <Card>
        <CardContent className="pt-2">
          {auditQuery.isLoading ? (
            <TableSkeleton columnCount={5} headers={["When", "Actor", "Action", "Target", "Result"]} />
          ) : events.length === 0 ? (
            <EmptyState icon={ScrollText} title="No events yet" description="Audit events will appear here as they occur." />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((event) => (
                      <TableRow key={event.auditEventId}>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {new Date(event.occurredAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{event.actorAccountId || "—"}</TableCell>
                        <TableCell className="text-sm">{event.action}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{event.target || "—"}</TableCell>
                        <TableCell className="text-sm">{event.result}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile timeline cards */}
              <div className="flex flex-col gap-3 sm:hidden">
                {events.map((event) => (
                  <div
                    key={event.auditEventId}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{event.action}</span>
                      <span className="text-xs text-muted-foreground">{event.result}</span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {new Date(event.occurredAt).toLocaleString()}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {event.actorAccountId || "—"} → {event.target || "—"}
                    </p>
                  </div>
                ))}
              </div>

              {auditQuery.hasNextPage ? (
                <div className="flex justify-center pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => auditQuery.fetchNextPage()}
                    disabled={auditQuery.isFetchingNextPage}
                  >
                    {auditQuery.isFetchingNextPage ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Loading…
                      </>
                    ) : (
                      "Load more"
                    )}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

