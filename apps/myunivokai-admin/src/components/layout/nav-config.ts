import type { LucideIcon } from "lucide-react";
import { Globe2, LayoutDashboard, ListChecks, ScrollText, Shield, Users } from "lucide-react";
import { PERMISSIONS, type PermissionCode } from "@/lib/session";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: PermissionCode;
}

// Dashboard, Worlds and Jobs read from analytics-service; Accounts, Roles and
// Audit read from auth-service. Each item's permission gates the nav entry
// here and the gateway route independently — the nav is a convenience, the
// gateway is the enforcement.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, permission: PERMISSIONS.chartRead },
  { href: "/worlds", label: "Worlds", icon: Globe2, permission: PERMISSIONS.worldRead },
  { href: "/jobs", label: "Jobs", icon: ListChecks, permission: PERMISSIONS.jobRead },
  { href: "/accounts", label: "Accounts", icon: Users, permission: PERMISSIONS.accountRead },
  { href: "/roles", label: "Roles", icon: Shield, permission: PERMISSIONS.roleRead },
  { href: "/audit", label: "Audit Log", icon: ScrollText, permission: PERMISSIONS.auditRead }
];
