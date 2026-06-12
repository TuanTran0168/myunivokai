package repositories

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
)

type MemoryStore struct {
	mu       sync.RWMutex
	worlds   map[string]models.World
	variants map[string][]models.WorldVariant
	slugs    map[string]string
	logs     []models.AIGenerationLog
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		worlds:   map[string]models.World{},
		variants: map[string][]models.WorldVariant{},
		slugs:    map[string]string{},
	}
}

func (s *MemoryStore) CreateWorld(ctx context.Context, world models.World, variant models.WorldVariant, logs []models.AIGenerationLog) (WorldBundle, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	if world.ID == "" {
		world.ID = uuid.NewString()
	}
	if variant.ID == "" {
		variant.ID = uuid.NewString()
	}
	world.CreatedAt = now
	world.UpdatedAt = now
	variant.WorldID = world.ID
	variant.CreatedAt = now
	variant.IsSelected = true
	world.SelectedVariantID = &variant.ID
	s.worlds[world.ID] = world
	s.variants[world.ID] = []models.WorldVariant{variant}
	s.logs = append(s.logs, logs...)
	return WorldBundle{World: world, Variants: []models.WorldVariant{variant}}, nil
}

func (s *MemoryStore) GetWorld(ctx context.Context, worldID string) (WorldBundle, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	world, ok := s.worlds[worldID]
	if !ok {
		return WorldBundle{}, ErrNotFound
	}
	return WorldBundle{World: world, Variants: cloneVariants(s.variants[worldID])}, nil
}

func (s *MemoryStore) AddVariant(ctx context.Context, worldID string, variant models.WorldVariant) (models.WorldVariant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.worlds[worldID]; !ok {
		return models.WorldVariant{}, ErrNotFound
	}
	for _, existingVariant := range s.variants[worldID] {
		if existingVariant.VariantNo == variant.VariantNo || existingVariant.Seed == variant.Seed {
			return models.WorldVariant{}, ErrConflict
		}
	}
	if variant.ID == "" {
		variant.ID = uuid.NewString()
	}
	variant.WorldID = worldID
	variant.CreatedAt = time.Now().UTC()
	s.variants[worldID] = append(s.variants[worldID], variant)
	return variant, nil
}

func (s *MemoryStore) SelectVariant(ctx context.Context, worldID, variantID string) (models.WorldVariant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	world, ok := s.worlds[worldID]
	if !ok {
		return models.WorldVariant{}, ErrNotFound
	}
	var selected models.WorldVariant
	found := false
	for i := range s.variants[worldID] {
		s.variants[worldID][i].IsSelected = s.variants[worldID][i].ID == variantID
		if s.variants[worldID][i].IsSelected {
			selected = s.variants[worldID][i]
			found = true
		}
	}
	if !found {
		return models.WorldVariant{}, ErrNotFound
	}
	world.SelectedVariantID = &variantID
	world.UpdatedAt = time.Now().UTC()
	s.worlds[worldID] = world
	return selected, nil
}

func (s *MemoryStore) PublishWorld(ctx context.Context, worldID, slug string) (models.World, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	world, ok := s.worlds[worldID]
	if !ok {
		return models.World{}, ErrNotFound
	}
	if world.ShareSlug == nil {
		if existingWorldID, slugTaken := s.slugs[slug]; slugTaken && existingWorldID != worldID {
			return models.World{}, ErrConflict
		}
		world.ShareSlug = &slug
	}
	world.Visibility = "public"
	world.UpdatedAt = time.Now().UTC()
	s.worlds[worldID] = world
	s.slugs[*world.ShareSlug] = worldID
	return world, nil
}

func (s *MemoryStore) GetPublicWorld(ctx context.Context, slug string) (WorldBundle, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	worldID, ok := s.slugs[slug]
	if !ok {
		return WorldBundle{}, ErrNotFound
	}
	world := s.worlds[worldID]
	if world.Visibility != "public" {
		return WorldBundle{}, ErrNotFound
	}
	return WorldBundle{World: world, Variants: cloneVariants(s.variants[worldID])}, nil
}

func (s *MemoryStore) Ping(ctx context.Context) error {
	return nil
}

func (s *MemoryStore) SaveAIGenerationLogs(ctx context.Context, logs []models.AIGenerationLog) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logs = append(s.logs, logs...)
	return nil
}

// AIGenerationLogs returns a copy of all stored AI logs; used by tests to
// assert that failed generations are recorded.
func (s *MemoryStore) AIGenerationLogs() []models.AIGenerationLog {
	s.mu.RLock()
	defer s.mu.RUnlock()
	logsCopy := make([]models.AIGenerationLog, len(s.logs))
	copy(logsCopy, s.logs)
	return logsCopy
}

func cloneVariants(in []models.WorldVariant) []models.WorldVariant {
	out := make([]models.WorldVariant, len(in))
	copy(out, in)
	return out
}
