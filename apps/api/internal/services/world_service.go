package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/myunivokai/myunivokai/apps/api/internal/ai"
	"github.com/myunivokai/myunivokai/apps/api/internal/ai/prompts"
	"github.com/myunivokai/myunivokai/apps/api/internal/config"
	"github.com/myunivokai/myunivokai/apps/api/internal/models"
	"github.com/myunivokai/myunivokai/apps/api/internal/repositories"
	"github.com/myunivokai/myunivokai/apps/api/internal/seed"
	"github.com/myunivokai/myunivokai/apps/api/internal/validation"
)

var ErrInvalidAIOutput = errors.New("ai output invalid")

type WorldService struct {
	cfg          config.Config
	store        repositories.Store
	orchestrator *ai.Orchestrator
	builder      *WorldConfigBuilder
}

func NewWorldService(cfg config.Config, store repositories.Store, orchestrator *ai.Orchestrator, builder *WorldConfigBuilder) *WorldService {
	return &WorldService{cfg: cfg, store: store, orchestrator: orchestrator, builder: builder}
}

func (s *WorldService) CreateWorld(ctx context.Context, input models.WorldInput) (models.CreateWorldResponse, error) {
	input = validation.NormalizeWorldInput(input)
	if s.orchestrator == nil {
		return models.CreateWorldResponse{}, errors.New("ai orchestrator is not configured")
	}
	request := ai.StructuredRequest{
		Task:          prompts.WorldDNATask,
		PromptVersion: s.cfg.AIPromptVersion,
		SystemPrompt:  prompts.WorldDNASystemPrompt,
		UserPrompt:    prompts.WorldDNAUserPrompt(input),
		SchemaName:    "personality_dna",
		Schema:        validation.PersonalityDNASchema(),
		Temperature:   0.7,
		MaxTokens:     1600,
	}
	result, err := s.orchestrator.GeneratePersonalityDNA(ctx, request)
	if err != nil {
		return models.CreateWorldResponse{}, fmt.Errorf("%w: %v", ErrInvalidAIOutput, err)
	}
	worldSeed, err := seed.NewWorldSeed()
	if err != nil {
		return models.CreateWorldResponse{}, err
	}
	config := s.builder.Build(BuildWorldConfigInput{DNA: result.DNA, Seed: worldSeed, VariantNo: 1, Input: input})
	world := models.World{
		Nickname:       input.Nickname,
		Role:           input.Role,
		Input:          input,
		PersonalityDNA: result.DNA,
		Archetype:      result.DNA.Archetype,
		SceneName:      result.DNA.SceneName,
		Quote:          result.DNA.Quote,
		ShortNarrative: result.DNA.ShortNarrative,
		Visibility:     "private",
	}
	variant := models.WorldVariant{VariantNo: 1, Seed: worldSeed, Config: config, IsSelected: true}
	bundle, err := s.store.CreateWorld(ctx, world, variant, buildLogs(input, request, result.Attempts))
	if err != nil {
		return models.CreateWorldResponse{}, err
	}
	selected := selectedVariant(bundle.Variants)
	return models.CreateWorldResponse{World: bundle.World, Variant: selected, PersonalityDNA: result.DNA}, nil
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
		PersonalityDNA:  bundle.World.PersonalityDNA,
	}, nil
}

func (s *WorldService) RegenerateVariant(ctx context.Context, worldID string) (models.VariantResponse, error) {
	bundle, err := s.store.GetWorld(ctx, worldID)
	if err != nil {
		return models.VariantResponse{}, err
	}
	nextNo := len(bundle.Variants) + 1
	variantSeed, err := seed.NewVariantSeed(worldID, nextNo)
	if err != nil {
		return models.VariantResponse{}, err
	}
	config := s.builder.Build(BuildWorldConfigInput{DNA: bundle.World.PersonalityDNA, Seed: variantSeed, VariantNo: nextNo, Input: bundle.World.Input})
	variant, err := s.store.AddVariant(ctx, worldID, models.WorldVariant{VariantNo: nextNo, Seed: variantSeed, Config: config})
	if err != nil {
		return models.VariantResponse{}, err
	}
	return models.VariantResponse{Variant: variant}, nil
}

func (s *WorldService) SelectVariant(ctx context.Context, worldID, variantID string) (models.VariantResponse, error) {
	variant, err := s.store.SelectVariant(ctx, worldID, variantID)
	if err != nil {
		return models.VariantResponse{}, err
	}
	return models.VariantResponse{Variant: variant}, nil
}

func (s *WorldService) PublishWorld(ctx context.Context, worldID string) (models.PublishResponse, error) {
	slugSuffix := strings.ReplaceAll(worldID, "-", "")
	if len(slugSuffix) > 6 {
		slugSuffix = slugSuffix[:6]
	}
	base := "orbit"
	bundle, err := s.store.GetWorld(ctx, worldID)
	if err != nil {
		return models.PublishResponse{}, err
	}
	if bundle.World.Nickname != "" {
		base = slugify(bundle.World.Nickname)
	}
	if base == "" {
		base = "orbit"
	}
	slug := base + "-" + slugSuffix
	world, err := s.store.PublishWorld(ctx, worldID, slug)
	if err != nil {
		return models.PublishResponse{}, err
	}
	if world.ShareSlug == nil {
		return models.PublishResponse{}, errors.New("share slug was not created")
	}
	return models.PublishResponse{ShareSlug: *world.ShareSlug, ShareURL: strings.TrimRight(s.cfg.PublicWebURL, "/") + "/share/" + *world.ShareSlug}, nil
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
			ShortNarrative: bundle.World.PersonalityDNA.ShortNarrative,
		},
		Variant:   models.PublicVariant{Seed: variant.Seed, Config: variant.Config},
		PublicDNA: models.PublicDNA{TraitScores: bundle.World.PersonalityDNA.TraitScores, Planets: bundle.World.PersonalityDNA.Planets},
	}, nil
}

func buildLogs(input models.WorldInput, req ai.StructuredRequest, attempts []ai.AttemptLog) []models.AIGenerationLog {
	payload, _ := json.Marshal(input)
	hash := sha256.Sum256(payload)
	requestJSON, _ := json.Marshal(map[string]any{"task": req.Task, "promptVersion": req.PromptVersion})
	logs := make([]models.AIGenerationLog, 0, len(attempts))
	for _, attempt := range attempts {
		logs = append(logs, models.AIGenerationLog{
			Provider:      attempt.Provider,
			Model:         attempt.Model,
			Task:          req.Task,
			PromptVersion: req.PromptVersion,
			InputHash:     hex.EncodeToString(hash[:]),
			RequestJSON:   requestJSON,
			ResponseJSON:  attempt.Response,
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
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			if b.Len() > 0 && !strings.HasSuffix(b.String(), "-") {
				b.WriteRune('-')
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

func NewID() string {
	return uuid.NewString()
}
