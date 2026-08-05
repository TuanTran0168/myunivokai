package repositories

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

type memoryRole struct {
	id                  string
	name                string
	description         string
	audience            contracts.AccountAudience
	isSystem            bool
	permissionCodenames map[string]struct{}
}

// MemoryStore is a real in-process implementation of Store, not a mock —
// the same convention universe-service's MemoryStore follows. It backs
// AuthService's tests so the business logic (lockout, refresh rotation,
// reuse detection) is exercised without a database.
type MemoryStore struct {
	mu                   sync.RWMutex
	accountsByID         map[string]Account
	accountIDByEmail     map[string]string
	permissions          map[string]PermissionDefinition
	roles                map[string]*memoryRole
	roleIDByName         map[string]string
	accountRoleIDs       map[string]map[string]struct{}
	refreshTokensByID    map[string]RefreshToken
	refreshTokenIDByHash map[string]string
	auditEvents          []AuditEvent
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		accountsByID:         map[string]Account{},
		accountIDByEmail:     map[string]string{},
		permissions:          map[string]PermissionDefinition{},
		roles:                map[string]*memoryRole{},
		roleIDByName:         map[string]string{},
		accountRoleIDs:       map[string]map[string]struct{}{},
		refreshTokensByID:    map[string]RefreshToken{},
		refreshTokenIDByHash: map[string]string{},
	}
}

func (store *MemoryStore) CreateAccount(_ context.Context, params CreateAccountParams) (Account, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	email := strings.ToLower(strings.TrimSpace(params.Email))
	if _, exists := store.accountIDByEmail[email]; exists {
		return Account{}, ErrConflict
	}
	now := time.Now().UTC()
	account := Account{
		ID:                  uuid.NewString(),
		Email:               email,
		PasswordHash:        params.PasswordHash,
		Kind:                params.Kind,
		IsSuperAdmin:        params.IsSuperAdmin,
		TokenVersion:        1,
		ForcePasswordChange: params.ForcePasswordChange,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	store.accountsByID[account.ID] = account
	store.accountIDByEmail[email] = account.ID
	return account, nil
}

func (store *MemoryStore) GetAccountByEmail(_ context.Context, email string) (Account, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	accountID, found := store.accountIDByEmail[strings.ToLower(strings.TrimSpace(email))]
	if !found {
		return Account{}, ErrNotFound
	}
	return store.accountsByID[accountID], nil
}

func (store *MemoryStore) GetAccountByID(_ context.Context, accountID string) (Account, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return Account{}, ErrNotFound
	}
	return account, nil
}

func (store *MemoryStore) AccountRolesAndPermissions(_ context.Context, accountID string) ([]string, []string, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	roleNames := make([]string, 0)
	permissionSet := map[string]struct{}{}
	for roleID := range store.accountRoleIDs[accountID] {
		role, found := store.roles[roleID]
		if !found {
			continue
		}
		roleNames = append(roleNames, role.name)
		for codename := range role.permissionCodenames {
			permissionSet[codename] = struct{}{}
		}
	}
	permissions := make([]string, 0, len(permissionSet))
	for codename := range permissionSet {
		permissions = append(permissions, codename)
	}
	return roleNames, permissions, nil
}

func (store *MemoryStore) CountSuperAdmins(_ context.Context) (int, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	count := 0
	for _, account := range store.accountsByID {
		if account.IsSuperAdmin && !account.Disabled {
			count++
		}
	}
	return count, nil
}

func (store *MemoryStore) RecordFailedLoginAttempt(_ context.Context, accountID string, lockThreshold int, lockDuration time.Duration) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return ErrNotFound
	}
	account.FailedAttempts++
	if account.FailedAttempts >= lockThreshold {
		lockedUntil := time.Now().UTC().Add(lockDuration)
		account.LockedUntil = &lockedUntil
	}
	account.UpdatedAt = time.Now().UTC()
	store.accountsByID[accountID] = account
	return nil
}

func (store *MemoryStore) ResetFailedLoginAttempts(_ context.Context, accountID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return ErrNotFound
	}
	account.FailedAttempts = 0
	account.LockedUntil = nil
	account.UpdatedAt = time.Now().UTC()
	store.accountsByID[accountID] = account
	return nil
}

func (store *MemoryStore) BumpTokenVersion(_ context.Context, accountID string) (int, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return 0, ErrNotFound
	}
	account.TokenVersion++
	account.UpdatedAt = time.Now().UTC()
	store.accountsByID[accountID] = account
	return account.TokenVersion, nil
}

func (store *MemoryStore) SetAccountDisabled(_ context.Context, accountID string, disabled bool) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return ErrNotFound
	}
	account.Disabled = disabled
	account.UpdatedAt = time.Now().UTC()
	store.accountsByID[accountID] = account
	return nil
}

func (store *MemoryStore) CreateRefreshToken(_ context.Context, token RefreshToken) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, exists := store.refreshTokenIDByHash[token.TokenHash]; exists {
		return ErrConflict
	}
	if token.ID == "" {
		token.ID = uuid.NewString()
	}
	token.CreatedAt = time.Now().UTC()
	store.refreshTokensByID[token.ID] = token
	store.refreshTokenIDByHash[token.TokenHash] = token.ID
	return nil
}

func (store *MemoryStore) GetRefreshTokenByHash(_ context.Context, tokenHash string) (RefreshToken, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	tokenID, found := store.refreshTokenIDByHash[tokenHash]
	if !found {
		return RefreshToken{}, ErrNotFound
	}
	return store.refreshTokensByID[tokenID], nil
}

func (store *MemoryStore) MarkRefreshTokenUsed(_ context.Context, tokenID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	token, found := store.refreshTokensByID[tokenID]
	if !found {
		return ErrNotFound
	}
	usedAt := time.Now().UTC()
	token.UsedAt = &usedAt
	store.refreshTokensByID[tokenID] = token
	return nil
}

func (store *MemoryStore) RevokeRefreshTokenFamily(_ context.Context, familyID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	now := time.Now().UTC()
	for id, token := range store.refreshTokensByID {
		if token.FamilyID == familyID && token.RevokedAt == nil {
			token.RevokedAt = &now
			store.refreshTokensByID[id] = token
		}
	}
	return nil
}

func (store *MemoryStore) RevokeAllRefreshTokensForAccount(_ context.Context, accountID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	now := time.Now().UTC()
	for id, token := range store.refreshTokensByID {
		if token.AccountID == accountID && token.RevokedAt == nil {
			token.RevokedAt = &now
			store.refreshTokensByID[id] = token
		}
	}
	return nil
}

func (store *MemoryStore) SyncPermissions(_ context.Context, definitions []PermissionDefinition) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	known := make(map[string]struct{}, len(definitions))
	for _, definition := range definitions {
		store.permissions[string(definition.Codename)] = definition
		known[string(definition.Codename)] = struct{}{}
	}
	for codename := range store.permissions {
		if _, stillDeclared := known[codename]; !stillDeclared {
			delete(store.permissions, codename)
		}
	}
	return nil
}

func (store *MemoryStore) EnsureSystemRole(_ context.Context, name, description string, audience contracts.AccountAudience, permissionCodenames []string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	roleID, exists := store.roleIDByName[name]
	if !exists {
		roleID = uuid.NewString()
		store.roleIDByName[name] = roleID
	}
	codenameSet := make(map[string]struct{}, len(permissionCodenames))
	for _, codename := range permissionCodenames {
		codenameSet[codename] = struct{}{}
	}
	store.roles[roleID] = &memoryRole{
		id: roleID, name: name, description: description, audience: audience, isSystem: true, permissionCodenames: codenameSet,
	}
	return nil
}

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

// AssignRole is a test/bootstrap convenience — production role assignment
// is a phase-5/7 admin mutation, not part of this store's core contract.
func (store *MemoryStore) AssignRole(accountID, roleName string) {
	store.mu.Lock()
	defer store.mu.Unlock()
	roleID, found := store.roleIDByName[roleName]
	if !found {
		return
	}
	if store.accountRoleIDs[accountID] == nil {
		store.accountRoleIDs[accountID] = map[string]struct{}{}
	}
	store.accountRoleIDs[accountID][roleID] = struct{}{}
}
