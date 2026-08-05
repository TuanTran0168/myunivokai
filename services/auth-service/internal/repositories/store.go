package repositories

import (
	"context"
	"errors"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

type Account struct {
	ID                  string
	Email               string
	PasswordHash        string
	Kind                contracts.AccountKind
	IsSuperAdmin        bool
	Disabled            bool
	TokenVersion        int
	FailedAttempts      int
	LockedUntil         *time.Time
	ForcePasswordChange bool
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type RefreshToken struct {
	ID        string
	AccountID string
	FamilyID  string
	TokenHash string
	UsedAt    *time.Time
	RevokedAt *time.Time
	ExpiresAt time.Time
	CreatedAt time.Time
}

// PermissionDefinition is the Go-declared source of truth synced into the
// permissions table at startup. Staff read these; they never invent them -
// see notes/vision/auth-and-admin-plan.md#amended--dynamic-modelled-on-django-auth.
type PermissionDefinition struct {
	Codename    contracts.PermissionCode
	Description string
	Audience    contracts.AccountAudience
}

type AuditEvent struct {
	ActorAccountID *string
	Action         string
	Target         string
	Result         string
	SourceAddress  string
}

type CreateAccountParams struct {
	Email               string
	PasswordHash        string
	Kind                contracts.AccountKind
	IsSuperAdmin        bool
	ForcePasswordChange bool
}

// Store is auth-service's persistence boundary. Every method here is the
// only path to myunivokai_auth; nothing outside this package touches SQL.
type Store interface {
	CreateAccount(ctx context.Context, params CreateAccountParams) (Account, error)
	GetAccountByEmail(ctx context.Context, email string) (Account, error)
	GetAccountByID(ctx context.Context, accountID string) (Account, error)
	AccountRolesAndPermissions(ctx context.Context, accountID string) (roles []string, permissions []string, err error)
	CountSuperAdmins(ctx context.Context) (int, error)

	RecordFailedLoginAttempt(ctx context.Context, accountID string, lockThreshold int, lockDuration time.Duration) error
	ResetFailedLoginAttempts(ctx context.Context, accountID string) error
	BumpTokenVersion(ctx context.Context, accountID string) (int, error)
	SetAccountDisabled(ctx context.Context, accountID string, disabled bool) error

	CreateRefreshToken(ctx context.Context, token RefreshToken) error
	GetRefreshTokenByHash(ctx context.Context, tokenHash string) (RefreshToken, error)
	MarkRefreshTokenUsed(ctx context.Context, tokenID string) error
	RevokeRefreshTokenFamily(ctx context.Context, familyID string) error
	RevokeAllRefreshTokensForAccount(ctx context.Context, accountID string) error

	SyncPermissions(ctx context.Context, definitions []PermissionDefinition) error
	EnsureSystemRole(ctx context.Context, name, description string, audience contracts.AccountAudience, permissionCodenames []string) error

	RecordAuditEvent(ctx context.Context, event AuditEvent) error
}
