package ai

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/apps/api/internal/models"
	"github.com/myunivokai/myunivokai/apps/api/internal/validation"
)

type failingProvider struct{}

func (p failingProvider) Name() ProviderName { return ProviderName("failing") }

func (p failingProvider) GenerateStructured(ctx context.Context, req StructuredRequest) (*StructuredResponse, error) {
	return nil, errors.New("boom")
}

type successProvider struct{}

func (p successProvider) Name() ProviderName { return ProviderMock }

func (p successProvider) GenerateStructured(ctx context.Context, req StructuredRequest) (*StructuredResponse, error) {
	dna := models.PersonalityDNA{
		SchemaVersion:   "1.0",
		Archetype:       "Builder Explorer",
		SceneName:       "The Cyan Builder Galaxy",
		Quote:           "I build worlds from curious ideas.",
		ShortNarrative:  "A curious builder.",
		TraitScores:     models.TraitScores{Creativity: 90, Discipline: 80, Curiosity: 95, Energy: 70, Focus: 88},
		EnergySignature: models.EnergySignature{Primary: "creative", Secondary: "explorer", Intensity: 86},
		Planets: []models.DNAPlanet{
			{Key: "coding", Name: "Code Atlas", Meaning: "Builder energy.", Energy: 90},
			{Key: "travel", Name: "Wayfinder", Meaning: "Explorer energy.", Energy: 80},
			{Key: "photo", Name: "Light Archive", Meaning: "Visual memory.", Energy: 70},
		},
		VisualHints: models.VisualHints{Theme: "cosmic-galaxy"},
	}
	raw, _ := json.Marshal(dna)
	return &StructuredResponse{Provider: ProviderMock, Model: "success", JSON: raw}, nil
}

func TestOrchestratorFallback(t *testing.T) {
	orch := NewOrchestrator(failingProvider{}, successProvider{}, validation.ValidatePersonalityDNA, time.Second)
	result, err := orch.GeneratePersonalityDNA(context.Background(), StructuredRequest{})
	if err != nil {
		t.Fatalf("expected fallback success: %v", err)
	}
	if result.DNA.Archetype == "" {
		t.Fatalf("expected dna")
	}
	if len(result.Attempts) != 2 {
		raw, _ := json.Marshal(result.Attempts)
		t.Fatalf("expected 2 attempts, got %s", raw)
	}
}
