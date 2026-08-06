import { adminRequest } from "@/lib/admin-http";
import type { AccountSummary } from "./types";

export interface AccountListResponse {
  accounts: AccountSummary[];
  nextCursor?: string;
}

export const accountsApi = {
  list: (cursor?: string) =>
    adminRequest<AccountListResponse>(`/accounts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  get: (accountId: string) => adminRequest<AccountSummary>(`/accounts/${accountId}`),
  invite: (email: string, roleIds: string[]) =>
    adminRequest<{ accountId: string; inviteToken: string; inviteExpiresAt: string }>("/accounts/invite", {
      method: "POST",
      body: JSON.stringify({ email, roleIds })
    }),
  disable: (accountId: string) => adminRequest<void>(`/accounts/${accountId}/disable`, { method: "POST" }),
  enable: (accountId: string) => adminRequest<void>(`/accounts/${accountId}/enable`, { method: "POST" })
};
