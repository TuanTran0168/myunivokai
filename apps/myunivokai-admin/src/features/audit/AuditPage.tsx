"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
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
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : events.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <>
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
              {auditQuery.hasNextPage ? (
                <div className="flex justify-center pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => auditQuery.fetchNextPage()}
                    disabled={auditQuery.isFetchingNextPage}
                  >
                    {auditQuery.isFetchingNextPage ? "Loading…" : "Load more"}
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
