package repositories

import "context"

func (store *PostgresStore) RecordAuditEvent(ctx context.Context, event AuditEvent) error {
	_, err := store.pool.Exec(ctx, `INSERT INTO audit_events (actor_account_id, action, target, result, source_address)
		VALUES ($1,$2,$3,$4,$5)`, event.ActorAccountID, event.Action, event.Target, event.Result, event.SourceAddress)
	return err
}
