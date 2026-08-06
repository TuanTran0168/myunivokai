"use client";

import { use } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "motion/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { adminApi, type AdminApiError } from "@/lib/admin-api";

export default function AccountDetailPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = use(params);
  const queryClient = useQueryClient();
  const accountQuery = useQuery({ queryKey: ["accounts", accountId], queryFn: () => adminApi.getAccount(accountId) });
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: adminApi.listRoles });

  const assignMutation = useMutation({
    mutationFn: (roleId: string) => adminApi.assignRole(accountId, roleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts", accountId] }),
    onError: (error: AdminApiError) => toast.error(error.message)
  });
  const revokeMutation = useMutation({
    mutationFn: (roleId: string) => adminApi.revokeRole(accountId, roleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts", accountId] }),
    onError: (error: AdminApiError) => toast.error(error.message)
  });

  const account = accountQuery.data;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="glass-panel border-none">
        <CardHeader>
          <CardTitle className="font-heading text-xl">{account?.email ?? "…"}</CardTitle>
          <CardDescription>
            {account?.isSuperAdmin ? <Badge variant="outline">super admin</Badge> : "Manage this account's roles."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rolesQuery.data?.roles.map((role) => {
            const isAssigned = account?.roles.includes(role.name) ?? false;
            return (
              <label key={role.roleId} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
                <div>
                  <p className="text-sm font-medium">{role.name}</p>
                  <p className="text-xs text-muted-foreground">{role.permissions.join(", ") || "no permissions"}</p>
                </div>
                <Checkbox
                  checked={isAssigned}
                  disabled={account?.isSuperAdmin}
                  onCheckedChange={(checked) => {
                    if (checked) assignMutation.mutate(role.roleId);
                    else revokeMutation.mutate(role.roleId);
                  }}
                />
              </label>
            );
          })}
        </CardContent>
      </Card>
    </motion.div>
  );
}
