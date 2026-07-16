package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/ai/prompts"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/config"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/seed"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/validation"
	"github.com/rs/zerolog/log"
)

var ErrInvalidAIOutput = errors.New("ai output invalid")

// ErrAIUnavailable distinguishes "the AI provider could not be reached"
// (transport failure — the caller should retry later) from ErrInvalidAIOutput
// ("the provider answered but the content was unusable").
var ErrAIUnavailable = errors.New("ai service unavailable")

// Concurrent requests can race on unique columns (variant_no, share_slug).
// The store reports ErrConflict and the service retries with fresh values.
const (
	maximumVariantCreateAttempts = 3
	maximumPublishAttempts       = 3
)

type WorldService struct {
	cfg          config.Config
	store        repositories.Store
	orchestrator *ai.Orchestrator
	builder      *ForestConfigBuilder
}

func NewWorldService(cfg config.Config, store repositories.Store, orchestrator *ai.Orchestrator, builder *ForestConfigBuilder) *WorldService {
	return &WorldService{cfg: cfg, store: store, orchestrator: orchestrator, builder: builder}
}

func (s *WorldService) CreateWorld(ctx context.Context, input models.WorldInput) (models.CreateWorldResponse, error) {
	input = validation.NormalizeWorldInput(input)
	if s.orchestrator == nil {
		return models.CreateWorldResponse{}, errors.New("ai orchestrator is not configured")
	}
	request := ai.StructuredRequest{
		Task:          prompts.ForestDNATask,
		PromptVersion: s.cfg.AIPromptVersion,
		SystemPrompt:  prompts.ForestDNASystemPrompt,
		UserPrompt:    prompts.ForestDNAUserPrompt(input),
		RepairPrompt:  prompts.RepairPrompt,
		SchemaName:    "nature_dna",
		Schema:        validation.NatureDNASchema(),
		Temperature:   0.7,
		MaxTokens:     1600,
	}
	result, err := s.orchestrator.GenerateNatureDNA(ctx, request)
	if err != nil {
		// Failed attempts must still be recorded so the team can debug
		// provider/schema problems from the ai_generations log.
		if result != nil && len(result.Attempts) > 0 {
			if saveErr := s.store.SaveAIGenerationLogs(ctx, buildLogs(input, request, result.Attempts)); saveErr != nil {
				log.Error().Err(saveErr).Msg("save failed ai generation logs")
			}
		}
		serviceErr := ErrInvalidAIOutput
		if errors.Is(err, ai.ErrProviderUnavailable) {
			serviceErr = ErrAIUnavailable
		}
		return models.CreateWorldResponse{}, fmt.Errorf("%w: %v", serviceErr, err)
	}
	worldSeed, err := seed.NewWorldSeed()
	if err != nil {
		return models.CreateWorldResponse{}, err
	}
	forestConfig := s.builder.Build(BuildForestConfigInput{DNA: result.DNA, Seed: worldSeed, VariantNo: 1, Input: input})
	world := models.World{
		Nickname:       input.Nickname,
		Role:           input.Role,
		Input:          input,
		NatureDNA:      result.DNA,
		Archetype:      result.DNA.Archetype,
		SceneName:      result.DNA.SceneName,
		Quote:          result.DNA.Quote,
		ShortNarrative: result.DNA.ShortNarrative,
		Visibility:     "private",
	}
	variant := models.WorldVariant{VariantNo: 1, Seed: worldSeed, Config: forestConfig, IsSelected: true}
	bundle, err := s.store.CreateWorld(ctx, world, variant, buildLogs(input, request, result.Attempts))
	if err != nil {
		return models.CreateWorldResponse{}, err
	}
	selected := selectedVariant(bundle.Variants)
	return models.CreateWorldResponse{World: bundle.World, Variant: selected, NatureDNA: result.DNA}, nil
}

func (s *WorldService) GetWorld(ctx context.Context, worldID string) (models.WorldResponse, error) {
	bundle, err := s.store.GetWorld(ctx, worldID)
	if err != nil {
		return models.WorldResponse{}, err
	}
	return models.WorldResponse{
		World:           bundle.World,
		SelectedVariant: selectedVariant(bundle.Variants),
		Variants:        bundle.Variants,
		NatureDNA:       bundle.World.NatureDNA,
	}, nil
}

// GetWorlds loads a batch of worlds in one store round-trip pair; ids that do
// not exist are simply absent from the result (the caller decides how to
// present gaps), matching batch-read semantics rather than failing everything.
func (s *WorldService) GetWorlds(ctx context.Context, worldIDs []string) (models.WorldListResponse, error) {
	bundles, err := s.store.GetWorldsByIDs(ctx, worldIDs)
	if err != nil {
		return models.WorldListResponse{}, err
	}
	worlds := make([]models.WorldResponse, 0, len(bundles))
	for _, bundle := range bundles {
		worlds = append(worlds, models.WorldResponse{
			World:           bundle.World,
			SelectedVariant: selectedVariant(bundle.Variants),
			Variants:        bundle.Variants,
			NatureDNA:       bundle.World.NatureDNA,
		})
	}
	return models.WorldListResponse{Worlds: worlds}, nil
}

// RegenerateVariant creates a new visual variant without calling AI: a fresh
// seed re-runs the deterministic forest builder over the stored DNA — a new
// season/weather roll for the same person, at zero AI cost.
func (s *WorldService) RegenerateVariant(ctx context.Context, worldID string) (models.VariantResponse, error) {
	var lastConflictErr error
	for attempt := 1; attempt <= maximumVariantCreateAttempts; attempt++ {
		bundle, err := s.store.GetWorld(ctx, worldID)
		if err != nil {
			return models.VariantResponse{}, err
		}
		nextVariantNo := highestVariantNumber(bundle.Variants) + 1
		variantSeed, err := seed.NewVariantSeed(worldID, nextVariantNo)
		if err != nil {
			return models.VariantResponse{}, err
		}
		forestConfig := s.builder.Build(BuildForestConfigInput{DNA: bundle.World.NatureDNA, Seed: variantSeed, VariantNo: nextVariantNo, Input: bundle.World.Input})
		variant, err := s.store.AddVariant(ctx, worldID, models.WorldVariant{VariantNo: nextVariantNo, Seed: variantSeed, Config: forestConfig})
		if err == nil {
			return models.VariantResponse{Variant: variant}, nil
		}
		if !errors.Is(err, repositories.ErrConflict) {
			return models.VariantResponse{}, err
		}
		// Another request claimed this variant number; reload and retry.
		lastConflictErr = err
	}
	return models.VariantResponse{}, lastConflictErr
}

func highestVariantNumber(variants []models.WorldVariant) int {
	highest := 0
	for _, variant := range variants {
		if variant.VariantNo > highest {
			highest = variant.VariantNo
		}
	}
	return highest
}

func (s *WorldService) SelectVariant(ctx context.Context, worldID, variantID string) (models.VariantResponse, error) {
	variant, err := s.store.SelectVariant(ctx, worldID, variantID)
	if err != nil {
		return models.VariantResponse{}, err
	}
	return models.VariantResponse{Variant: variant}, nil
}

func (s *WorldService) PublishWorld(ctx context.Context, worldID string) (models.PublishResponse, error) {
	bundle, err := s.store.GetWorld(ctx, worldID)
	if err != nil {
		return models.PublishResponse{}, err
	}
	slugBase := slugify(bundle.World.Nickname)
	if slugBase == "" {
		slugBase = "grove"
	}

	var lastConflictErr error
	for attempt := 1; attempt <= maximumPublishAttempts; attempt++ {
		slugSuffix, err := seed.NewShareSlugSuffix(s.cfg.ShareSlugLength)
		if err != nil {
			return models.PublishResponse{}, err
		}
		slug := slugBase + "-" + slugSuffix
		world, err := s.store.PublishWorld(ctx, worldID, slug)
		if err == nil {
			if world.ShareSlug == nil {
				return models.PublishResponse{}, errors.New("share slug was not created")
			}
			return models.PublishResponse{ShareSlug: *world.ShareSlug, ShareURL: strings.TrimRight(s.cfg.PublicWebURL, "/") + "/share/" + *world.ShareSlug}, nil
		}
		if !errors.Is(err, repositories.ErrConflict) {
			return models.PublishResponse{}, err
		}
		// Another world owns this slug; retry with a fresh random suffix.
		lastConflictErr = err
	}
	return models.PublishResponse{}, lastConflictErr
}

func (s *WorldService) GetPublicWorld(ctx context.Context, slug string) (models.PublicWorldResponse, error) {
	bundle, err := s.store.GetPublicWorld(ctx, slug)
	if err != nil {
		return models.PublicWorldResponse{}, err
	}
	variant := selectedVariant(bundle.Variants)
	return models.PublicWorldResponse{
		World: models.PublicWorld{
			Nickname:       bundle.World.Nickname,
			Archetype:      bundle.World.Archetype,
			SceneName:      bundle.World.SceneName,
			Quote:          bundle.World.Quote,
			ShortNarrative: bundle.World.NatureDNA.ShortNarrative,
		},
		Variant:   models.PublicVariant{Seed: variant.Seed, Config: variant.Config},
		PublicDNA: models.PublicDNA{TraitScores: bundle.World.NatureDNA.TraitScores, Landmarks: bundle.World.NatureDNA.Landmarks},
	}, nil
}

func buildLogs(input models.WorldInput, req ai.StructuredRequest, attempts []ai.AttemptLog) []models.AIGenerationLog {
	payload, _ := json.Marshal(input)
	hash := sha256.Sum256(payload)
	requestJSON, _ := json.Marshal(map[string]any{"task": req.Task, "promptVersion": req.PromptVersion})
	logs := make([]models.AIGenerationLog, 0, len(attempts))
	for _, attempt := range attempts {
		var usageJSON []byte
		if attempt.Usage != (ai.Usage{}) {
			usageJSON, _ = json.Marshal(attempt.Usage)
		}
		logs = append(logs, models.AIGenerationLog{
			Provider:      attempt.Provider,
			Model:         attempt.Model,
			Task:          req.Task,
			PromptVersion: req.PromptVersion,
			InputHash:     hex.EncodeToString(hash[:]),
			RequestJSON:   requestJSON,
			ResponseJSON:  attempt.Response,
			UsageJSON:     usageJSON,
			LatencyMS:     int(attempt.Latency.Milliseconds()),
			Status:        attempt.Status,
			Error:         attempt.Error,
		})
	}
	return logs
}

func selectedVariant(variants []models.WorldVariant) models.WorldVariant {
	for _, variant := range variants {
		if variant.IsSelected {
			return variant
		}
	}
	if len(variants) > 0 {
		return variants[0]
	}
	return models.WorldVariant{}
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var slugBuilder strings.Builder
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z', character >= '0' && character <= '9':
			slugBuilder.WriteRune(character)
		case character == ' ' || character == '-' || character == '_':
			if slugBuilder.Len() > 0 && !strings.HasSuffix(slugBuilder.String(), "-") {
				slugBuilder.WriteRune('-')
			}
		}
	}
	return strings.Trim(slugBuilder.String(), "-")
}
