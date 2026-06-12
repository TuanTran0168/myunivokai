package services

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/apps/api/internal/ai"
	"github.com/myunivokai/myunivokai/apps/api/internal/ai/providers"
	"github.com/myunivokai/myunivokai/apps/api/internal/config"
	"github.com/myunivokai/myunivokai/apps/api/internal/models"
	"github.com/myunivokai/myunivokai/apps/api/internal/repositories"
	"github.com/myunivokai/myunivokai/apps/api/internal/validation"
)

type alwaysFailingProvider struct{}

func (p *alwaysFailingProvider) Name() ai.ProviderName { return ai.ProviderName("failing") }

func (p *alwaysFailingProvider) GenerateStructured(ctx context.Context, req ai.StructuredRequest) (*ai.StructuredResponse, error) {
	return nil, errors.New("simulated provider outage")
}

func validWorldInput() models.WorldInput {
	return models.WorldInput{
		Nickname:            "Tuan",
		Role:                "Developer",
		Interests:           []string{"coding", "travel", "photo"},
		Traits:              []string{"curious", "builder", "focused"},
		Goal:                "Build a beautiful AI product",
		Mood:                "futuristic calm",
		FavoriteColors:      []string{"#8B5CF6"},
		PreferredWorldStyle: "cosmic-galaxy",
	}
}

func newTestWorldService(store repositories.Store, provider ai.Provider) *WorldService {
	cfg := config.Config{AIPromptVersion: "world-dna-v1"}
	orchestrator := ai.NewOrchestrator(provider, nil, validation.ValidatePersonalityDNA, time.Second)
	return NewWorldService(cfg, store, orchestrator, NewWorldConfigBuilder())
}

func TestCreateWorldPersistsFailedAttemptLogs(t *testing.T) {
	memoryStore := repositories.NewMemoryStore()
	service := newTestWorldService(memoryStore, &alwaysFailingProvider{})

	_, err := service.CreateWorld(context.Background(), validWorldInput())
	if err == nil {
		t.Fatal("expected CreateWorld to fail when every provider fails")
	}

	savedLogs := memoryStore.AIGenerationLogs()
	if len(savedLogs) != 1 {
		t.Fatalf("expected 1 failed attempt log, got %d", len(savedLogs))
	}
	if savedLogs[0].Status != "failed" {
		t.Fatalf("expected failed status, got %q", savedLogs[0].Status)
	}
	if savedLogs[0].Error == "" {
		t.Fatal("expected the provider error message to be recorded")
	}
}

// conflictOnFirstCallStore wraps a real store and simulates the race where a
// concurrent request claims the same variant number or share slug first.
type conflictOnFirstCallStore struct {
	repositories.Store
	variantConflictsRemaining int
	publishConflictsRemaining int
}

func (s *conflictOnFirstCallStore) AddVariant(ctx context.Context, worldID string, variant models.WorldVariant) (models.WorldVariant, error) {
	if s.variantConflictsRemaining > 0 {
		s.variantConflictsRemaining--
		return models.WorldVariant{}, repositories.ErrConflict
	}
	return s.Store.AddVariant(ctx, worldID, variant)
}

func (s *conflictOnFirstCallStore) PublishWorld(ctx context.Context, worldID, slug string) (models.World, error) {
	if s.publishConflictsRemaining > 0 {
		s.publishConflictsRemaining--
		return models.World{}, repositories.ErrConflict
	}
	return s.Store.PublishWorld(ctx, worldID, slug)
}

func TestRegenerateVariantRetriesOnConflict(t *testing.T) {
	conflictingStore := &conflictOnFirstCallStore{Store: repositories.NewMemoryStore(), variantConflictsRemaining: 1}
	service := newTestWorldService(conflictingStore, providers.NewMock())

	created, err := service.CreateWorld(context.Background(), validWorldInput())
	if err != nil {
		t.Fatalf("CreateWorld failed: %v", err)
	}

	response, err := service.RegenerateVariant(context.Background(), created.World.ID)
	if err != nil {
		t.Fatalf("expected variant creation to retry past the conflict: %v", err)
	}
	if response.Variant.VariantNo != 2 {
		t.Fatalf("expected variant number 2, got %d", response.Variant.VariantNo)
	}
}

func TestPublishWorldRetriesOnSlugConflict(t *testing.T) {
	conflictingStore := &conflictOnFirstCallStore{Store: repositories.NewMemoryStore(), publishConflictsRemaining: 1}
	service := newTestWorldService(conflictingStore, providers.NewMock())

	created, err := service.CreateWorld(context.Background(), validWorldInput())
	if err != nil {
		t.Fatalf("CreateWorld failed: %v", err)
	}

	response, err := service.PublishWorld(context.Background(), created.World.ID)
	if err != nil {
		t.Fatalf("expected publish to retry with a fresh slug: %v", err)
	}
	if !strings.HasPrefix(response.ShareSlug, "tuan-") {
		t.Fatalf("expected slug built from nickname, got %q", response.ShareSlug)
	}
}

func TestCreateWorldRecordsTokenUsage(t *testing.T) {
	memoryStore := repositories.NewMemoryStore()
	service := newTestWorldService(memoryStore, providers.NewMock())

	_, err := service.CreateWorld(context.Background(), validWorldInput())
	if err != nil {
		t.Fatalf("CreateWorld with mock provider failed: %v", err)
	}

	savedLogs := memoryStore.AIGenerationLogs()
	if len(savedLogs) != 1 {
		t.Fatalf("expected 1 success log, got %d", len(savedLogs))
	}
	if savedLogs[0].Status != "success" {
		t.Fatalf("expected success status, got %q", savedLogs[0].Status)
	}
	if len(savedLogs[0].UsageJSON) == 0 {
		t.Fatal("expected usage_json to be recorded for the attempt")
	}
}
