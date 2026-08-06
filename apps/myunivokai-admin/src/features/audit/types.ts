export interface AuditEventSummary {
  auditEventId: string;
  actorAccountId: string;
  action: string;
  target?: string;
  result: string;
  sourceAddress: string;
  occurredAt: string;
}
