import type { LucideIcon } from "lucide-react";
import { Globe2, LayoutDashboard, Users } from "lucide-react";
import { PERMISSIONS, type PermissionCode } from "@/lib/session";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: PermissionCode;
}

// One representative item per permission family is enough to prove the
// RBAC-nav mechanism (S4-AUTH-004's scenario: "navigation items are hidden,
// not just disabled, for permissions the account lacks"). The pages these
// point to are placeholders; the real screens are S4-ANALYTICS-007 and
// S4-AUTH-005's job, not this phase's.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, permission: PERMISSIONS.chartRead },
  { href: "/worlds", label: "Worlds", icon: Globe2, permission: PERMISSIONS.worldRead },
  { href: "/accounts", label: "Accounts", icon: Users, permission: PERMISSIONS.accountRead }
];
