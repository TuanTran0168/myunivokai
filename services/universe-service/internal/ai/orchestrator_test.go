package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/validation"
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

// invalidThenValidProvider returns broken JSON on the first call and valid DNA
// once it receives a repair prompt, mimicking a model that fixes its output.
type invalidThenValidProvider struct {
	callCount          int
	sawRepairPrompt    bool
	repairPromptMarker string
}

func (p *invalidThenValidProvider) Name() ProviderName { return ProviderName("flaky") }

func (p *invalidThenValidProvider) GenerateStructured(ctx context.Context, req StructuredRequest) (*StructuredResponse, error) {
	p.callCount++
	if p.callCount == 1 {
		return &StructuredResponse{Provider: p.Name(), Model: "flaky", JSON: json.RawMessage(`{"archetype": 123}`)}, nil
	}
	if p.repairPromptMarker != "" && strings.Contains(req.UserPrompt, p.repairPromptMarker) {
		p.sawRepairPrompt = true
	}
	return successProvider{}.GenerateStructured(ctx, req)
}

func TestOrchestratorRepairsInvalidJSONWithSameProvider(t *testing.T) {
	repairMarker := "did not match the required schema"
	provider := &invalidThenValidProvider{repairPromptMarker: repairMarker}
	orch := NewOrchestrator(provider, failingProvider{}, validation.ValidatePersonalityDNA, time.Second).WithRepairAttempts(1)

	result, err := orch.GeneratePersonalityDNA(context.Background(), StructuredRequest{
		UserPrompt:   "Generate DNA",
		RepairPrompt: "Your previous output did not match the required schema. Return a corrected JSON object only.",
	})
	if err != nil {
		t.Fatalf("expected repair retry to succeed: %v", err)
	}
	if provider.callCount != 2 {
		t.Fatalf("expected 2 calls to the same provider, got %d", provider.callCount)
	}
	if !provider.sawRepairPrompt {
		t.Fatal("expected the second call to include the repair prompt")
	}
	if len(result.Attempts) != 2 {
		t.Fatalf("expected 2 logged attempts, got %d", len(result.Attempts))
	}
	if result.Attempts[0].Status != "failed" || result.Attempts[1].Status != "success" {
		t.Fatalf("unexpected attempt statuses: %+v", result.Attempts)
	}
}

func TestOrchestratorDoesNotRepairTransportErrors(t *testing.T) {
	orch := NewOrchestrator(failingProvider{}, successProvider{}, validation.ValidatePersonalityDNA, time.Second).WithRepairAttempts(2)
	result, err := orch.GeneratePersonalityDNA(context.Background(), StructuredRequest{UserPrompt: "Generate DNA"})
	if err != nil {
		t.Fatalf("expected fallback to succeed: %v", err)
	}
	// Transport failure must go straight to fallback: 1 failed + 1 success.
	if len(result.Attempts) != 2 {
		t.Fatalf("expected 2 attempts (no repair on transport error), got %d", len(result.Attempts))
	}
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
