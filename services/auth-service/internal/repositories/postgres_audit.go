package repositories

import "context"

func (store *PostgresStore) RecordAuditEvent(ctx context.Context, event AuditEvent) error {
	_, err := store.pool.Exec(ctx, `INSERT INTO audit_events (actor_account_id, action, target, result, source_address)
		VALUES ($1,$2,$3,$4,$5)`, event.ActorAccountID, event.Action, event.Target, event.Result, event.SourceAddress)
	return err
}

// ListAuditEvents orders occurred_at DESC, id DESC — same keyset scheme as
// ListAccounts (see cursor.go).
func (store *PostgresStore) ListAuditEvents(ctx context.Context, cursor string, pageSize int) ([]AuditEvent, string, error) {
	const selectColumns = `id::text, actor_account_id::text, action, target, result, source_address, occurred_at`
	var rows interface {
		Next() bool
		Scan(dest ...any) error
		Err() error
		Close()
	}
	if cursor == "" {
		queryRows, err := store.pool.Query(ctx, `SELECT `+selectColumns+`
			FROM audit_events ORDER BY occurred_at DESC, id DESC LIMIT $1`, pageSize+1)
		if err != nil {
			return nil, "", err
		}
		rows = queryRows
	} else {
		cursorTime, cursorID, decodeErr := decodeCursor(cursor)
		if decodeErr != nil {
			return nil, "", decodeErr
		}
		queryRows, err := store.pool.Query(ctx, `SELECT `+selectColumns+`
			FROM audit_events WHERE (occurred_at, id) < ($1, $2::uuid) ORDER BY occurred_at DESC, id DESC LIMIT $3`, cursorTime, cursorID, pageSize+1)
		if err != nil {
			return nil, "", err
		}
		rows = queryRows
	}
	defer rows.Close()

	events := make([]AuditEvent, 0, pageSize)
	for rows.Next() {
		var event AuditEvent
		var actorAccountID, target *string
		if err := rows.Scan(&event.ID, &actorAccountID, &event.Action, &target, &event.Result, &event.SourceAddress, &event.OccurredAt); err != nil {
			return nil, "", err
		}
		event.ActorAccountID = actorAccountID
		if target != nil {
			event.Target = *target
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}

	var nextCursor string
	if len(events) > pageSize {
		last := events[pageSize-1]
		nextCursor = encodeCursor(last.OccurredAt, last.ID)
		events = events[:pageSize]
	}
	return events, nextCursor, nil
}
