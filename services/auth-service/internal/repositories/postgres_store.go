package repositories

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

const (
	postgresUniqueViolationCode = "23505"
	postgresForeignKeyCode      = "23503"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

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

func (store *PostgresStore) RevokeAllRefreshTokensForAccount(ctx context.Context, accountID string) error {
	_, err := store.pool.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = NOW() WHERE account_id = $1 AND revoked_at IS NULL`, accountID)
	return err
}

func (store *PostgresStore) CreateRefreshToken(ctx context.Context, token RefreshToken) error {
	_, err := store.pool.Exec(ctx, `INSERT INTO refresh_tokens (id, account_id, family_id, token_hash, expires_at)
		VALUES ($1,$2,$3,$4,$5)`, token.ID, token.AccountID, token.FamilyID, token.TokenHash, token.ExpiresAt)
	return mapConstraintViolation(err)
}

func (store *PostgresStore) GetRefreshTokenByHash(ctx context.Context, tokenHash string) (RefreshToken, error) {
	var token RefreshToken
	err := store.pool.QueryRow(ctx, `SELECT id::text, account_id::text, family_id::text, token_hash, used_at, revoked_at, expires_at, created_at
		FROM refresh_tokens WHERE token_hash = $1`, tokenHash,
	).Scan(&token.ID, &token.AccountID, &token.FamilyID, &token.TokenHash, &token.UsedAt, &token.RevokedAt, &token.ExpiresAt, &token.CreatedAt)
	if err != nil {
		return RefreshToken{}, mapNotFound(err)
	}
	return token, nil
}

func (store *PostgresStore) MarkRefreshTokenUsed(ctx context.Context, tokenID string) error {
	_, err := store.pool.Exec(ctx, `UPDATE refresh_tokens SET used_at = NOW() WHERE id = $1`, tokenID)
	return err
}

func (store *PostgresStore) RevokeRefreshTokenFamily(ctx context.Context, familyID string) error {
	_, err := store.pool.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL`, familyID)
	return err
}

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

func (store *PostgresStore) RecordAuditEvent(ctx context.Context, event AuditEvent) error {
	_, err := store.pool.Exec(ctx, `INSERT INTO audit_events (actor_account_id, action, target, result, source_address)
		VALUES ($1,$2,$3,$4,$5)`, event.ActorAccountID, event.Action, event.Target, event.Result, event.SourceAddress)
	return err
}

func mapNotFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func mapConstraintViolation(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case postgresUniqueViolationCode:
			return ErrConflict
		case postgresForeignKeyCode:
			return ErrNotFound
		}
	}
	return mapNotFound(err)
}
