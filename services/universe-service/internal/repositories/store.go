package repositories

import (
	"context"
	"errors"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
)

var ErrNotFound = errors.New("not found")

// ErrConflict signals a uniqueness collision (duplicate variant number or
// share slug). Callers retry with fresh values instead of surfacing a 500.
var ErrConflict = errors.New("conflict")

type WorldBundle struct {
	World    models.World
	Variants []models.WorldVariant
}

type Store interface {
	CreateWorld(ctx context.Context, world models.World, variant models.WorldVariant, logs []models.AIGenerationLog) (WorldBundle, error)
	GetWorld(ctx context.Context, worldID string) (WorldBundle, error)
	AddVariant(ctx context.Context, worldID string, variant models.WorldVariant) (models.WorldVariant, error)
	SelectVariant(ctx context.Context, worldID, variantID string) (models.WorldVariant, error)
	PublishWorld(ctx context.Context, worldID, slug string) (models.World, error)
	GetPublicWorld(ctx context.Context, slug string) (WorldBundle, error)
	// SaveAIGenerationLogs persists AI attempt logs outside the world-creation
	// transaction, so failed generations are still recorded for debugging.
	SaveAIGenerationLogs(ctx context.Context, logs []models.AIGenerationLog) error
	// Ping reports whether the backing storage is reachable; used by /readyz.
	Ping(ctx context.Context) error
}
