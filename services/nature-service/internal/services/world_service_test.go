package services

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/ai/providers"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/config"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/validation"
)

func newTestWorldService(t *testing.T) (*WorldService, *repositories.MemoryStore) {
	t.Helper()
	store := repositories.NewMemoryStore()
	orchestrator := ai.NewOrchestrator(providers.NewMock(), nil, validation.ValidateNatureDNA, time.Second)
	cfg := config.Config{PublicWebURL: "http://localhost:3000", ShareSlugLength: 10}
	return NewWorldService(cfg, store, orchestrator, NewForestConfigBuilder()), store
}

func validWorldInput() models.WorldInput {
	return models.WorldInput{
		Nickname:            "Tuan",
		Interests:           []string{"hiking", "music", "photography"},
		Traits:              []string{"curious", "calm", "kind"},
		Goal:                "Grow a quiet forest of my own.",
		Mood:                "reflective",
		FavoriteColors:      []string{"#8B5CF6", "#06B6D4"},
		PreferredWorldStyle: "aurora",
	}
}

func TestCreateWorldStoresForestVariant(t *testing.T) {
	service, _ := newTestWorldService(t)
	response, err := service.CreateWorld(context.Background(), validWorldInput())
	if err != nil {
		t.Fatalf("CreateWorld: %v", err)
	}
	if response.World.ID == "" {
		t.Fatalf("world must get an id")
	}
	if response.Variant.VariantNo != 1 || !response.Variant.IsSelected {
		t.Fatalf("variant 1 must exist and be selected, got %+v", response.Variant)
	}
	if !strings.HasPrefix(response.Variant.Seed, "NAT-") {
		t.Fatalf("world seed %q must carry the NAT- prefix", response.Variant.Seed)
	}
	if response.Variant.Config.SceneType != forestSceneType || response.Variant.Config.SchemaVersion != forestSchemaVersion {
		t.Fatalf("config must be a forest %s config, got %s/%s", forestSchemaVersion, response.Variant.Config.SceneType, response.Variant.Config.SchemaVersion)
	}
	if len(response.Variant.Config.Landmarks) != len(response.NatureDNA.Landmarks) {
		t.Fatalf("config landmarks (%d) must match DNA landmarks (%d)", len(response.Variant.Config.Landmarks), len(response.NatureDNA.Landmarks))
	}
	if len(response.NatureDNA.Landmarks) < 3 {
		t.Fatalf("mock DNA must produce at least 3 landmarks")
	}
}

func TestRegenerateVariantIsDeterministicFromStoredDNA(t *testing.T) {
	service, _ := newTestWorldService(t)
	created, err := service.CreateWorld(context.Background(), validWorldInput())
	if err != nil {
		t.Fatalf("CreateWorld: %v", err)
	}
	regenerated, err := service.RegenerateVariant(context.Background(), created.World.ID)
	if err != nil {
		t.Fatalf("RegenerateVariant: %v", err)
	}
	if regenerated.Variant.VariantNo != 2 {
		t.Fatalf("variantNo = %d, want 2", regenerated.Variant.VariantNo)
	}
	if regenerated.Variant.Seed == created.Variant.Seed {
		t.Fatalf("regenerated variant must get a fresh seed")
	}
	// Rebuilding with the stored DNA and the variant's seed must reproduce the
	// stored config exactly — regenerate never calls AI.
	rebuilt := NewForestConfigBuilder().Build(BuildForestConfigInput{
		DNA:       created.NatureDNA,
		Seed:      regenerated.Variant.Seed,
		VariantNo: regenerated.Variant.VariantNo,
		Input:     validation.NormalizeWorldInput(validWorldInput()),
	})
	if !reflect.DeepEqual(regenerated.Variant.Config, rebuilt) {
		t.Fatalf("regenerated config must be reproducible from stored DNA + seed")
	}
}

func TestSelectVariantMarksSelection(t *testing.T) {
	service, _ := newTestWorldService(t)
	created, err := service.CreateWorld(context.Background(), validWorldInput())
	if err != nil {
		t.Fatalf("CreateWorld: %v", err)
	}
	regenerated, err := service.RegenerateVariant(context.Background(), created.World.ID)
	if err != nil {
		t.Fatalf("RegenerateVariant: %v", err)
	}
	selected, err := service.SelectVariant(context.Background(), created.World.ID, regenerated.Variant.ID)
	if err != nil {
		t.Fatalf("SelectVariant: %v", err)
	}
	if !selected.Variant.IsSelected || selected.Variant.ID != regenerated.Variant.ID {
		t.Fatalf("variant 2 must be selected, got %+v", selected.Variant)
	}
}

func TestPublishAndGetPublicWorld(t *testing.T) {
	service, _ := newTestWorldService(t)
	created, err := service.CreateWorld(context.Background(), validWorldInput())
	if err != nil {
		t.Fatalf("CreateWorld: %v", err)
	}
	published, err := service.PublishWorld(context.Background(), created.World.ID)
	if err != nil {
		t.Fatalf("PublishWorld: %v", err)
	}
	if !strings.HasPrefix(published.ShareSlug, "tuan-") {
		t.Fatalf("share slug %q must start with the slugified nickname", published.ShareSlug)
	}
	public, err := service.GetPublicWorld(context.Background(), published.ShareSlug)
	if err != nil {
		t.Fatalf("GetPublicWorld: %v", err)
	}
	if public.Variant.Config.SceneType != forestSceneType {
		t.Fatalf("public config must be a forest config")
	}
	if len(public.PublicDNA.Landmarks) != len(created.NatureDNA.Landmarks) {
		t.Fatalf("public DNA must expose the landmarks")
	}
}
