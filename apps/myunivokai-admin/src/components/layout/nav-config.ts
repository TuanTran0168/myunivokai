import type { LucideIcon } from "lucide-react";
import { Activity, Globe2, LayoutDashboard, ListChecks, ScrollText, Server, Shield, Users } from "lucide-react";
import { PERMISSIONS, type PermissionCode } from "@/lib/session";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: PermissionCode;
}

// Dashboard, Worlds, Jobs and Fleet read from analytics-service; Telemetry
// reads from telemetry-service; Accounts, Roles and Audit read from
// auth-service. Each item's permission gates the nav entry here and the
// gateway route independently — the nav is a convenience, the gateway is the
// enforcement.
//
// Fleet and Telemetry are gated on chartRead rather than a permission of their
// own because the routes behind them already are: the gateway guards
// /service-starts, /wake-stats and /telemetry/* with chartRead, and inventing
// a code here would let the nav and the gateway disagree about who may see it.
//
// This list is now EIGHT entries and has quietly grown a third axis. Dashboard,
// Worlds and Jobs are product data; Fleet and Telemetry are the platform
// operating itself; Accounts, Roles and Audit are staff administration. The
// grouping already exists in this comment and nowhere in the UI, which is the
// point at which it stops being cosmetic — see DEFERRED-S5-NAV-001 in
// notes/sprints/sprint-05-2026-08-13/user-stories.md. Deliberately not built
// yet: the owner asked for it to be revisited once the sidebar demonstrably
// feels crowded, not on the day the eighth entry landed.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, permission: PERMISSIONS.chartRead },
  { href: "/worlds", label: "Worlds", icon: Globe2, permission: PERMISSIONS.worldRead },
  { href: "/jobs", label: "Jobs", icon: ListChecks, permission: PERMISSIONS.jobRead },
  { href: "/fleet", label: "Fleet", icon: Server, permission: PERMISSIONS.chartRead },
  { href: "/telemetry", label: "Telemetry", icon: Activity, permission: PERMISSIONS.chartRead },
  { href: "/accounts", label: "Accounts", icon: Users, permission: PERMISSIONS.accountRead },
  { href: "/roles", label: "Roles", icon: Shield, permission: PERMISSIONS.roleRead },
  { href: "/audit", label: "Audit Log", icon: ScrollText, permission: PERMISSIONS.auditRead }
];
