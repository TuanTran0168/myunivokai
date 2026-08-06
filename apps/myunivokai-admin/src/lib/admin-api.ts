import type { AccountSummary, AuditEventSummary, PermissionSummary, RoleSummary } from "./admin-types";

export class AdminApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = payload.error ?? {};
    throw new AdminApiError(response.status, error.code || "REQUEST_FAILED", error.message || "The request failed.");
  }
  return payload as T;
}

export interface AccountListResponse {
  accounts: AccountSummary[];
  nextCursor?: string;
}

export const adminApi = {
  listAccounts: (cursor?: string) =>
    request<AccountListResponse>(`/accounts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  getAccount: (accountId: string) => request<AccountSummary>(`/accounts/${accountId}`),
  inviteAccount: (email: string, roleIds: string[]) =>
    request<{ accountId: string; inviteToken: string; inviteExpiresAt: string }>("/accounts/invite", {
      method: "POST",
      body: JSON.stringify({ email, roleIds })
    }),
  disableAccount: (accountId: string) => request<void>(`/accounts/${accountId}/disable`, { method: "POST" }),
  enableAccount: (accountId: string) => request<void>(`/accounts/${accountId}/enable`, { method: "POST" }),

  listRoles: () => request<{ roles: RoleSummary[] }>("/roles"),
  createRole: (input: { name: string; description: string; audience: "admin" | "web"; permissions: string[] }) =>
    request<RoleSummary>("/roles", { method: "POST", body: JSON.stringify(input) }),
  updateRole: (roleId: string, input: { description: string; permissions: string[] }) =>
    request<RoleSummary>(`/roles/${roleId}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteRole: (roleId: string) => request<void>(`/roles/${roleId}`, { method: "DELETE" }),
  assignRole: (accountId: string, roleId: string) =>
    request<void>("/roles/assign", { method: "POST", body: JSON.stringify({ accountId, roleId }) }),
  revokeRole: (accountId: string, roleId: string) =>
    request<void>("/roles/revoke", { method: "POST", body: JSON.stringify({ accountId, roleId }) }),

  listPermissions: () => request<{ permissions: PermissionSummary[] }>("/permissions"),
  listAuditEvents: (cursor?: string) =>
    request<{ events: AuditEventSummary[]; nextCursor?: string }>(`/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)
};
