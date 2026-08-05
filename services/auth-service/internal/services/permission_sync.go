package services

import (
	"context"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
)

// declaredPermissions is the single source of truth for every permission
// codename that exists. A permission row that no route checks grants
// nothing, so this list only grows alongside the route that enforces it -
// see notes/vision/auth-and-admin-plan.md#amended--dynamic-modelled-on-django-auth.
var declaredPermissions = []repositories.PermissionDefinition{
	{Codename: contracts.PermissionWorldRead, Description: "Read world records across families.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionWorldUnpublish, Description: "Revoke a world's public share slug.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionVariantRead, Description: "Read world variant records.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionJobRead, Description: "Read generation job records.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionJobRetry, Description: "Retry a failed generation job.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionProfileRead, Description: "Read profile records with personal fields masked.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionProfileReveal, Description: "Reveal a profile's masked raw input. Always audited.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionChartRead, Description: "Read business and job-health charts.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionAccountRead, Description: "Read staff account records.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionAccountManage, Description: "Create, disable and role-assign staff accounts.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionAuditRead, Description: "Read the audit event log.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionRoleRead, Description: "Read role and permission records.", Audience: contracts.AccountAudienceAdmin},
	{Codename: contracts.PermissionRoleManage, Description: "Create, edit and delete roles.", Audience: contracts.AccountAudienceAdmin},
}

const (
	basicUserRoleName        = "basic_user"
	basicUserRoleDescription = "Seeded default: can view charts and nothing else. New accounts are inert until roles are granted deliberately."
)

// SyncPermissionsAndSeedRoles runs at every startup. It is idempotent, so it
// is safe to call on every boot rather than only on first install; the
// source of truth is always this code, never a row a previous run left
// behind.
func SyncPermissionsAndSeedRoles(ctx context.Context, store repositories.Store) error {
	if err := store.SyncPermissions(ctx, declaredPermissions); err != nil {
		return err
	}
	return store.EnsureSystemRole(ctx, basicUserRoleName, basicUserRoleDescription, contracts.AccountAudienceAdmin, []string{string(contracts.PermissionChartRead)})
}
