package repositories

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"
)

func (store *MemoryStore) RecordAuditEvent(_ context.Context, event AuditEvent) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	event.ID = uuid.NewString()
	event.OccurredAt = time.Now().UTC()
	store.auditEvents = append(store.auditEvents, event)
	return nil
}

// ListAuditEvents mirrors PostgresStore's occurred_at DESC, id DESC keyset
// order (cursor.go).
func (store *MemoryStore) ListAuditEvents(_ context.Context, cursor string, pageSize int) ([]AuditEvent, string, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	all := make([]AuditEvent, len(store.auditEvents))
	copy(all, store.auditEvents)
	sort.Slice(all, func(i, j int) bool {
		if !all[i].OccurredAt.Equal(all[j].OccurredAt) {
			return all[i].OccurredAt.After(all[j].OccurredAt)
		}
		return all[i].ID > all[j].ID
	})

	startIndex := 0
	if cursor != "" {
		cursorTime, cursorID, err := decodeCursor(cursor)
		if err != nil {
			return nil, "", err
		}
		for index, event := range all {
			if event.OccurredAt.Before(cursorTime) || (event.OccurredAt.Equal(cursorTime) && event.ID < cursorID) {
				startIndex = index
				break
			}
			startIndex = index + 1
		}
	}

	remaining := all[startIndex:]
	var nextCursor string
	if len(remaining) > pageSize {
		last := remaining[pageSize-1]
		nextCursor = encodeCursor(last.OccurredAt, last.ID)
		remaining = remaining[:pageSize]
	}
	return remaining, nextCursor, nil
}

// AuditEvents returns a snapshot of every recorded event, for tests that
// assert on audit behavior rather than only on returned errors.
func (store *MemoryStore) AuditEvents() []AuditEvent {
	store.mu.RLock()
	defer store.mu.RUnlock()
	events := make([]AuditEvent, len(store.auditEvents))
	copy(events, store.auditEvents)
	return events
}
