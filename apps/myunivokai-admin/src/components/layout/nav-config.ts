import type { LucideIcon } from "lucide-react";
import { Globe2, LayoutDashboard, ScrollText, Shield, Users } from "lucide-react";
import { PERMISSIONS, type PermissionCode } from "@/lib/session";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: PermissionCode;
}

// Worlds stays a placeholder (S4-ANALYTICS-007's job); Accounts, Roles and
// Audit are real screens as of S4-AUTH-005.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, permission: PERMISSIONS.chartRead },
  { href: "/worlds", label: "Worlds", icon: Globe2, permission: PERMISSIONS.worldRead },
  { href: "/accounts", label: "Accounts", icon: Users, permission: PERMISSIONS.accountRead },
  { href: "/roles", label: "Roles", icon: Shield, permission: PERMISSIONS.roleRead },
  { href: "/audit", label: "Audit Log", icon: ScrollText, permission: PERMISSIONS.auditRead }
];
