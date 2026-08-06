"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "motion/react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { adminApi } from "@/lib/admin-api";
import { InviteAccountDialog } from "@/components/accounts/invite-account-dialog";
import { AccountRowActions } from "@/components/accounts/account-row-actions";

export default function AccountsPage() {
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: () => adminApi.listAccounts() });

  const disableMutation = useMutation({
    mutationFn: adminApi.disableAccount,
    onSuccess: () => {
      toast.success("Account disabled.");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: Error) => toast.error(error.message)
  });
  const enableMutation = useMutation({
    mutationFn: adminApi.enableAccount,
    onSuccess: () => {
      toast.success("Account enabled.");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: Error) => toast.error(error.message)
  });

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="glass-panel border-none">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="font-heading text-xl">Accounts</CardTitle>
          <Button size="sm" onClick={() => setIsInviteOpen(true)}>
            <UserPlus />
            Invite staff
          </Button>
        </CardHeader>
        <CardContent>
          {accountsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : accountsQuery.isError ? (
            <p className="text-sm text-destructive">{(accountsQuery.error as Error).message}</p>
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
                    <TableCell className="font-mono text-xs">{account.email}</TableCell>
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
    </motion.div>
  );
}
