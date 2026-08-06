"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { adminApi, type AdminApiError } from "@/lib/admin-api";

export function InviteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: adminApi.listRoles, enabled: open });

  const inviteMutation = useMutation({
    mutationFn: () => adminApi.inviteAccount(email, selectedRoleIds),
    onSuccess: (response) => {
      setIssuedToken(response.inviteToken);
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: AdminApiError) => toast.error(error.message)
  });

  function reset() {
    setEmail("");
    setSelectedRoleIds([]);
    setIssuedToken(null);
    inviteMutation.reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="glass-panel border-none">
        <DialogHeader>
          <DialogTitle>Invite staff</DialogTitle>
          <DialogDescription>
            No email is sent yet — copy the link below and share it with the new staff member yourself.
          </DialogDescription>
        </DialogHeader>
        {issuedToken ? (
          <div className="flex flex-col gap-3">
            <Label>Invite token (shown once)</Label>
            <div className="glass-panel rounded-md border-none p-3 font-mono text-xs break-all">{issuedToken}</div>
            <p className="text-xs text-muted-foreground">
              Share this token with {email}; they enter it on the sign-in page to set their password.
            </p>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              inviteMutation.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Roles</Label>
              <div className="flex flex-col gap-2">
                {rolesQuery.data?.roles.map((role) => (
                  <label key={role.roleId} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedRoleIds.includes(role.roleId)}
                      onCheckedChange={(checked) =>
                        setSelectedRoleIds((current) =>
                          checked ? [...current, role.roleId] : current.filter((id) => id !== role.roleId)
                        )
                      }
                    />
                    {role.name}
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending ? "Creating invite…" : "Create invite"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
