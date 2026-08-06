import type { AccountSummary } from "./session";

export type { AccountSummary };

export interface RoleSummary {
  roleId: string;
  name: string;
  description?: string;
  audience: "admin" | "web";
  isSystem: boolean;
  permissions: string[];
}

export interface PermissionSummary {
  codename: string;
  description: string;
  audience: "admin" | "web";
}

export interface AuditEventSummary {
  auditEventId: string;
  actorAccountId: string;
  action: string;
  target?: string;
  result: string;
  sourceAddress: string;
  occurredAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}
