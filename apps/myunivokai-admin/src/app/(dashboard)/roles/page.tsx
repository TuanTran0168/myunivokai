"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { adminApi } from "@/lib/admin-api";
import type { RoleSummary } from "@/lib/admin-types";
import { RoleFormDialog } from "@/components/roles/role-form-dialog";
import { DeleteRoleDialog } from "@/components/roles/delete-role-dialog";

export default function RolesPage() {
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: adminApi.listRoles });
  const [formTarget, setFormTarget] = useState<{ open: boolean; role?: RoleSummary }>({ open: false });
  const [deleteTarget, setDeleteTarget] = useState<RoleSummary | null>(null);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="glass-panel border-none">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="font-heading text-xl">Roles</CardTitle>
          <Button size="sm" onClick={() => setFormTarget({ open: true, role: undefined })}>
            <Plus />
            New role
          </Button>
        </CardHeader>
        <CardContent>
          {rolesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rolesQuery.data?.roles.map((role) => (
                  <TableRow key={role.roleId}>
                    <TableCell>
                      {role.name} {role.isSystem ? <Badge variant="outline">system</Badge> : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {role.permissions.map((codename) => (
                          <Badge key={codename} variant="secondary" className="font-mono text-[10px]">
                            {codename}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {role.isSystem ? null : (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon-sm" aria-label="Role actions">
                                <MoreHorizontal />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setFormTarget({ open: true, role })}>Edit</DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(role)}>
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <RoleFormDialog
        open={formTarget.open}
        role={formTarget.role}
        onOpenChange={(open) => setFormTarget((current) => ({ ...current, open }))}
      />
      {deleteTarget ? (
        <DeleteRoleDialog open={Boolean(deleteTarget)} onOpenChange={() => setDeleteTarget(null)} role={deleteTarget} />
      ) : null}
    </motion.div>
  );
}
