package services

import (
	"context"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/config"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/repositories"
)

func newTestWorldService(store repositories.Store) *WorldService {
	serviceConfig := config.Config{PublicWebURL: "http://localhost:3000", ShareSlugLength: 10}
	return NewWorldService(serviceConfig, store, NewWorldConfigBuilder())
}

func validComposeEnvelope() contracts.Envelope[contracts.ComposeWorldData] {
	return contracts.NewEnvelope("01K0ABCDEF1234567890", contracts.ComposeWorldData{
		Family:       contracts.WorldFamilyUniverse,
		ProfileID:    "27ddcd8a-ea36-4f79-9b7f-b831e29d10c4",
		DNAVersionID: "577c956d-83d6-4a1e-b09a-65f0a69d1c67",
		Profile:      contracts.ProfileSummary{Nickname: "Tuan", Role: "Developer"},
		VisualIntent: contracts.VisualIntent{Mood: "focused", FavoriteColors: []string{"#8B5CF6", "#06B6D4"}, PreferredWorldStyle: "cosmic-galaxy"},
		ProfileDNA: contracts.ProfileDNA{
			SchemaVersion:  "1.0",
			Archetype:      "Builder Explorer",
			SceneName:      "The Cyan Builder",
			Quote:          "I build worlds from curious ideas.",
			ShortNarrative: "A curious builder who turns ideas into useful worlds.",
			TraitScores:    contracts.TraitScores{Creativity: 90, Discipline: 86, Curiosity: 92, Energy: 80, Focus: 90},
			EnergySignature: contracts.EnergySignature{
				Primary: "builder", Secondary: "explorer", Intensity: 86,
			},
			Facets: []contracts.ProfileFacet{
				{Key: "coding", Name: "Coding", Kind: "interest", Meaning: "Where ideas become useful systems.", Energy: 90},
				{Key: "design", Name: "Design", Kind: "interest", Meaning: "Where clarity becomes form.", Energy: 82},
				{Key: "focused", Name: "Focused", Kind: "trait", Meaning: "The discipline that compounds.", Energy: 88},
			},
			VisualHints: contracts.VisualHints{Theme: "cosmic-galaxy", CoreSymbol: "crystal", PaletteIntent: "purple cyan", MotionIntent: "calm orbiting"},
		},
	})
}

func TestComposeWorldPreservesUniverseResponseShape(t *testing.T) {
	store := repositories.NewMemoryStore()
	service := newTestWorldService(store)
	response, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("compose world: %v", err)
	}
	if response.World.ID == "" || response.Variant.ID == "" {
		t.Fatal("expected persisted world and variant identifiers")
	}
	if response.Variant.Config.SceneType != "universe" {
		t.Fatalf("expected universe scene type, got %q", response.Variant.Config.SceneType)
	}
	if len(response.PersonalityDNA.Planets) != 3 || response.PersonalityDNA.Planets[0].Type != "Interest Planet" {
		t.Fatalf("unexpected family DNA mapping: %#v", response.PersonalityDNA.Planets)
	}
}

func TestComposeWorldIsIdempotentForRedelivery(t *testing.T) {
	store := repositories.NewMemoryStore()
	service := newTestWorldService(store)
	first, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("first compose: %v", err)
	}
	second, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("redelivered compose: %v", err)
	}
	if first.World.ID != second.World.ID {
		t.Fatalf("redelivery created a second world: %s != %s", first.World.ID, second.World.ID)
	}
	messages, err := store.PendingOutbox(context.Background(), 10)
	if err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("expected one completion event, got %d", len(messages))
	}
}

type conflictOnFirstCallStore struct {
	repositories.Store
	variantConflictsRemaining int
	publishConflictsRemaining int
}

func (store *conflictOnFirstCallStore) AddVariant(ctx context.Context, worldID string, variant models.WorldVariant) (models.WorldVariant, error) {
	if store.variantConflictsRemaining > 0 {
		store.variantConflictsRemaining--
		return models.WorldVariant{}, repositories.ErrConflict
	}
	return store.Store.AddVariant(ctx, worldID, variant)
}

func (store *conflictOnFirstCallStore) PublishWorld(ctx context.Context, worldID, shareSlug string) (models.World, error) {
	if store.publishConflictsRemaining > 0 {
		store.publishConflictsRemaining--
		return models.World{}, repositories.ErrConflict
	}
	return store.Store.PublishWorld(ctx, worldID, shareSlug)
}

func TestRegenerateVariantRetriesWithoutAI(t *testing.T) {
	store := &conflictOnFirstCallStore{Store: repositories.NewMemoryStore(), variantConflictsRemaining: 1}
	service := newTestWorldService(store)
	created, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("compose world: %v", err)
	}
	response, err := service.RegenerateVariant(context.Background(), created.World.ID)
	if err != nil {
		t.Fatalf("regenerate variant: %v", err)
	}
	if response.Variant.VariantNo != 2 {
		t.Fatalf("expected variant number 2, got %d", response.Variant.VariantNo)
	}
}

func TestPublishWorldRetriesOnSlugConflict(t *testing.T) {
	store := &conflictOnFirstCallStore{Store: repositories.NewMemoryStore(), publishConflictsRemaining: 1}
	service := newTestWorldService(store)
	created, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("compose world: %v", err)
	}
	response, err := service.PublishWorld(context.Background(), created.World.ID)
	if err != nil {
		t.Fatalf("publish world: %v", err)
	}
	if !strings.HasPrefix(response.ShareSlug, "tuan-") {
		t.Fatalf("expected slug based on nickname, got %q", response.ShareSlug)
	}
}
