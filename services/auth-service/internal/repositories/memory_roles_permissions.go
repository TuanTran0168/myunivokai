package repositories

import (
	"context"

	"github.com/google/uuid"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

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
