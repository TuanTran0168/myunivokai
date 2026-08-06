"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { accountsApi } from "./api";
import { InviteAccountDialog } from "./InviteAccountDialog";
import { AccountRowActions } from "./AccountRowActions";

export function AccountsPage() {
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: () => accountsApi.list() });

  const disableMutation = useMutation({
    mutationFn: accountsApi.disable,
    onSuccess: () => {
      toast.success("Account disabled.");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: Error) => toast.error(error.message)
  });
  const enableMutation = useMutation({
    mutationFn: accountsApi.enable,
    onSuccess: () => {
      toast.success("Account enabled.");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: Error) => toast.error(error.message)
  });

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Staff accounts, their roles and status."
        action={
          <Button size="sm" onClick={() => setIsInviteOpen(true)}>
            <UserPlus />
            Invite staff
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-2">
          {accountsQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : accountsQuery.isError ? (
            <p className="py-6 text-center text-sm text-destructive">{(accountsQuery.error as Error).message}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountsQuery.data?.accounts.map((account) => (
                  <TableRow key={account.accountId}>
                    <TableCell className="text-sm">{account.email}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {account.isSuperAdmin ? <Badge variant="outline">super admin</Badge> : null}
                        {account.roles.map((role) => (
                          <Badge key={role} variant="secondary">
                            {role}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {account.disabled ? (
                        <Badge variant="destructive">disabled</Badge>
                      ) : account.forcePasswordChange ? (
                        <Badge variant="outline">invited</Badge>
                      ) : (
                        <Badge>active</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <AccountRowActions
                        account={account}
                        onDisable={() => disableMutation.mutate(account.accountId)}
                        onEnable={() => enableMutation.mutate(account.accountId)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <InviteAccountDialog open={isInviteOpen} onOpenChange={setIsInviteOpen} />
    </div>
  );
}
