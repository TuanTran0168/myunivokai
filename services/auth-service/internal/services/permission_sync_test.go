package services

import (
	"context"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
)

func TestSyncPermissionsAndSeedRoles_SeedsBasicUserWithChartReadOnly(t *testing.T) {
	store := repositories.NewMemoryStore()
	if err := SyncPermissionsAndSeedRoles(context.Background(), store); err != nil {
		t.Fatalf("sync: %v", err)
	}

	account, err := store.CreateAccount(context.Background(), repositories.CreateAccountParams{
		Email: "basic@myunivokai.dev", PasswordHash: "irrelevant", Kind: contracts.AccountKindStaff,
	})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	store.AssignRoleByName(account.ID, basicUserRoleName)

	roles, permissions, err := store.AccountRolesAndPermissions(context.Background(), account.ID)
	if err != nil {
		t.Fatalf("account roles and permissions: %v", err)
	}
	if len(roles) != 1 || roles[0] != basicUserRoleName {
		t.Fatalf("expected exactly the basic_user role, got %v", roles)
	}
	if len(permissions) != 1 || permissions[0] != string(contracts.PermissionChartRead) {
		t.Fatalf("expected basic_user to hold only chart:read, got %v", permissions)
	}
}

func TestSyncPermissionsAndSeedRoles_IsIdempotent(t *testing.T) {
	store := repositories.NewMemoryStore()
	if err := SyncPermissionsAndSeedRoles(context.Background(), store); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if err := SyncPermissionsAndSeedRoles(context.Background(), store); err != nil {
		t.Fatalf("second sync: %v", err)
	}
}
