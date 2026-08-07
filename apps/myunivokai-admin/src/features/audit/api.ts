import { adminRequest } from "@/lib/admin-http";
import type { AuditEventSummary } from "./types";

export const auditApi = {
  list: (cursor?: string) =>
    adminRequest<{ events: AuditEventSummary[]; nextCursor?: string }>(
      `/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`
    )
};
