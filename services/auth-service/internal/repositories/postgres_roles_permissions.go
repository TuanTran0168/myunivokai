package repositories

import (
	"context"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// SyncPermissions makes the permissions table a projection of code, exactly
// as Django's Permission rows are generated from migrations. Unknown rows
// (declared in a past version, removed since) are pruned so the table never
// grants something no route checks - see
// notes/vision/auth-and-admin-plan.md#amended--dynamic-modelled-on-django-auth.
func (store *PostgresStore) SyncPermissions(ctx context.Context, definitions []PermissionDefinition) error {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)
	knownCodenames := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		knownCodenames = append(knownCodenames, string(definition.Codename))
		if _, err := transaction.Exec(ctx, `INSERT INTO permissions (codename, description, audience, is_system)
				VALUES ($1,$2,$3,TRUE)
			ON CONFLICT (codename) DO UPDATE SET description = EXCLUDED.description, audience = EXCLUDED.audience`,
			string(definition.Codename), definition.Description, string(definition.Audience),
		); err != nil {
			return err
		}
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM permissions WHERE NOT (codename = ANY($1::text[]))`, knownCodenames); err != nil {
		return err
	}
	return transaction.Commit(ctx)
}

// EnsureSystemRole creates or updates a system-owned role (is_system = TRUE)
// with exactly the given permission set. Called at startup for basic_user;
// safe to call every time the process boots because it is idempotent.
func (store *PostgresStore) EnsureSystemRole(ctx context.Context, name, description string, audience contracts.AccountAudience, permissionCodenames []string) error {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)
	var roleID string
	err = transaction.QueryRow(ctx, `INSERT INTO roles (name, description, audience, is_system)
			VALUES ($1,$2,$3,TRUE)
		ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
		RETURNING id::text`, name, description, string(audience)).Scan(&roleID)
	if err != nil {
		return err
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM role_permissions WHERE role_id = $1`, roleID); err != nil {
		return err
	}
	for _, codename := range permissionCodenames {
		if _, err := transaction.Exec(ctx, `INSERT INTO role_permissions (role_id, permission_id)
			SELECT $1, id FROM permissions WHERE codename = $2`, roleID, codename); err != nil {
			return err
		}
	}
	return transaction.Commit(ctx)
}
