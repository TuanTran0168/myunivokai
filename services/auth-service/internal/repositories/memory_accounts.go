package repositories

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
)

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
