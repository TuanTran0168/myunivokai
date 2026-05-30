package repositories

import (
	"context"
	"errors"

	"github.com/myunivokai/myunivokai/apps/api/internal/models"
)

var ErrNotFound = errors.New("not found")

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
}
