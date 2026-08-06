"use client";

import { use } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { AdminApiError } from "@/lib/admin-http";
import { rolesApi } from "@/features/roles/api";
import { accountsApi } from "./api";

export function AccountDetailPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = use(params);
  const queryClient = useQueryClient();
  const accountQuery = useQuery({ queryKey: ["accounts", accountId], queryFn: () => accountsApi.get(accountId) });
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: rolesApi.list });

  const assignMutation = useMutation({
    mutationFn: (roleId: string) => rolesApi.assign(accountId, roleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts", accountId] }),
    onError: (error: AdminApiError) => toast.error(error.message)
  });
  const revokeMutation = useMutation({
    mutationFn: (roleId: string) => rolesApi.revoke(accountId, roleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts", accountId] }),
    onError: (error: AdminApiError) => toast.error(error.message)
  });

  const account = accountQuery.data;

  return (
    <div>
      <PageHeader
        title={account?.email ?? "…"}
        description={account?.isSuperAdmin ? undefined : "Manage this account's roles."}
        action={account?.isSuperAdmin ? <Badge variant="outline">super admin</Badge> : undefined}
      />
      <Card>
        <CardContent className="flex flex-col gap-3 pt-2">
          {rolesQuery.data?.roles.map((role) => {
            const isAssigned = account?.roles.includes(role.name) ?? false;
            return (
              <label key={role.roleId} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
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
    </div>
  );
}
