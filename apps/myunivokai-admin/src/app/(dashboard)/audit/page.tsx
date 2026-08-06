"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminApi } from "@/lib/admin-api";

export default function AuditPage() {
  const auditQuery = useInfiniteQuery({
    queryKey: ["audit"],
    queryFn: ({ pageParam }: { pageParam?: string }) => adminApi.listAuditEvents(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor
  });

  const events = auditQuery.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="glass-panel border-none">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Audit Log</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {auditQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
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
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {new Date(event.occurredAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{event.actorAccountId || "—"}</TableCell>
                      <TableCell className="text-xs">{event.action}</TableCell>
                      <TableCell className="font-mono text-xs">{event.target || "—"}</TableCell>
                      <TableCell className="text-xs">{event.result}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {auditQuery.hasNextPage ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-center"
                  onClick={() => auditQuery.fetchNextPage()}
                  disabled={auditQuery.isFetchingNextPage}
                >
                  {auditQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
