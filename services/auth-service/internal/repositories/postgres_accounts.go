package repositories

import (
	"context"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

func (store *PostgresStore) CreateAccount(ctx context.Context, params CreateAccountParams) (Account, error) {
	var account Account
	account.Email = params.Email
	account.PasswordHash = params.PasswordHash
	account.Kind = params.Kind
	account.IsSuperAdmin = params.IsSuperAdmin
	account.ForcePasswordChange = params.ForcePasswordChange
	err := store.pool.QueryRow(ctx, `INSERT INTO accounts (email, password_hash, kind, is_super_admin, force_password_change)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id::text, disabled, token_version, failed_attempts, created_at, updated_at`,
		params.Email, params.PasswordHash, string(params.Kind), params.IsSuperAdmin, params.ForcePasswordChange,
	).Scan(&account.ID, &account.Disabled, &account.TokenVersion, &account.FailedAttempts, &account.CreatedAt, &account.UpdatedAt)
	if err != nil {
		return Account{}, mapConstraintViolation(err)
	}
	return account, nil
}

func (store *PostgresStore) GetAccountByEmail(ctx context.Context, email string) (Account, error) {
	return store.scanAccount(ctx, `email=$1`, email)
}

func (store *PostgresStore) GetAccountByID(ctx context.Context, accountID string) (Account, error) {
	return store.scanAccount(ctx, `id=$1`, accountID)
}

func (store *PostgresStore) scanAccount(ctx context.Context, predicate, value string) (Account, error) {
	var account Account
	var kind string
	err := store.pool.QueryRow(ctx, `SELECT id::text, email, password_hash, kind, is_super_admin, disabled, token_version,
			failed_attempts, locked_until, force_password_change, created_at, updated_at
		FROM accounts WHERE `+predicate, value,
	).Scan(&account.ID, &account.Email, &account.PasswordHash, &kind, &account.IsSuperAdmin, &account.Disabled,
		&account.TokenVersion, &account.FailedAttempts, &account.LockedUntil, &account.ForcePasswordChange, &account.CreatedAt, &account.UpdatedAt)
	if err != nil {
		return Account{}, mapNotFound(err)
	}
	account.Kind = contracts.AccountKind(kind)
	return account, nil
}

func (store *PostgresStore) AccountRolesAndPermissions(ctx context.Context, accountID string) ([]string, []string, error) {
	roleRows, err := store.pool.Query(ctx, `SELECT r.name FROM roles r
		JOIN account_roles ar ON ar.role_id = r.id WHERE ar.account_id = $1 ORDER BY r.name`, accountID)
	if err != nil {
		return nil, nil, err
	}
	defer roleRows.Close()
	roles := make([]string, 0)
	for roleRows.Next() {
		var roleName string
		if err := roleRows.Scan(&roleName); err != nil {
			return nil, nil, err
		}
		roles = append(roles, roleName)
	}
	if err := roleRows.Err(); err != nil {
		return nil, nil, err
	}

	permissionRows, err := store.pool.Query(ctx, `SELECT DISTINCT p.codename FROM permissions p
		JOIN role_permissions rp ON rp.permission_id = p.id
		JOIN account_roles ar ON ar.role_id = rp.role_id
		WHERE ar.account_id = $1 ORDER BY p.codename`, accountID)
	if err != nil {
		return nil, nil, err
	}
	defer permissionRows.Close()
	permissions := make([]string, 0)
	for permissionRows.Next() {
		var codename string
		if err := permissionRows.Scan(&codename); err != nil {
			return nil, nil, err
		}
		permissions = append(permissions, codename)
	}
	if err := permissionRows.Err(); err != nil {
		return nil, nil, err
	}
	return roles, permissions, nil
}

func (store *PostgresStore) CountSuperAdmins(ctx context.Context) (int, error) {
	var count int
	err := store.pool.QueryRow(ctx, `SELECT COUNT(*) FROM accounts WHERE is_super_admin AND NOT disabled`).Scan(&count)
	return count, err
}

func (store *PostgresStore) RecordFailedLoginAttempt(ctx context.Context, accountID string, lockThreshold int, lockDuration time.Duration) error {
	_, err := store.pool.Exec(ctx, `UPDATE accounts SET
			failed_attempts = failed_attempts + 1,
			locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN NOW() + make_interval(secs => $3) ELSE locked_until END,
			updated_at = NOW()
		WHERE id = $1`, accountID, lockThreshold, lockDuration.Seconds())
	return err
}

func (store *PostgresStore) ResetFailedLoginAttempts(ctx context.Context, accountID string) error {
	_, err := store.pool.Exec(ctx, `UPDATE accounts SET failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1`, accountID)
	return err
}

func (store *PostgresStore) BumpTokenVersion(ctx context.Context, accountID string) (int, error) {
	var tokenVersion int
	err := store.pool.QueryRow(ctx, `UPDATE accounts SET token_version = token_version + 1, updated_at = NOW()
		WHERE id = $1 RETURNING token_version`, accountID).Scan(&tokenVersion)
	if err != nil {
		return 0, mapNotFound(err)
	}
	return tokenVersion, nil
}

func (store *PostgresStore) SetAccountDisabled(ctx context.Context, accountID string, disabled bool) error {
	_, err := store.pool.Exec(ctx, `UPDATE accounts SET disabled = $2, updated_at = NOW() WHERE id = $1`, accountID, disabled)
	return err
}
