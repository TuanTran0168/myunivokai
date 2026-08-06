package repositories

import "context"

func (store *MemoryStore) RecordAuditEvent(_ context.Context, event AuditEvent) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.auditEvents = append(store.auditEvents, event)
	return nil
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
