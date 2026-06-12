package providers

import (
	"context"
	"encoding/json"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
)

type MockProvider struct{}

func NewMock() *MockProvider {
	return &MockProvider{}
}

func (p *MockProvider) Name() ai.ProviderName {
	return ai.ProviderMock
}

func (p *MockProvider) GenerateStructured(ctx context.Context, req ai.StructuredRequest) (*ai.StructuredResponse, error) {
	dna := models.PersonalityDNA{
		SchemaVersion:   "1.0",
		Archetype:       "Builder Explorer",
		SceneName:       "The Cyan Builder Galaxy",
		Quote:           "I build worlds from curious ideas.",
		ShortNarrative:  "A curious builder who turns ideas into useful worlds.",
		TraitScores:     models.TraitScores{Creativity: 92, Discipline: 84, Curiosity: 95, Energy: 78, Focus: 88},
		EnergySignature: models.EnergySignature{Primary: "creative", Secondary: "explorer", Intensity: 86},
		Planets: []models.DNAPlanet{
			{Key: "coding", Name: "Code Atlas", Type: "Interest Planet", Meaning: "Your builder mindset and ability to solve complex problems.", Energy: 90},
			{Key: "travel", Name: "Wayfinder", Type: "Interest Planet", Meaning: "Your instinct to explore new perspectives and places.", Energy: 82},
			{Key: "photography", Name: "Light Archive", Type: "Interest Planet", Meaning: "Your eye for meaning, contrast, and remembered moments.", Energy: 76},
		},
		VisualHints: models.VisualHints{Theme: "cosmic-galaxy", CoreSymbol: "crystal", PaletteIntent: "purple cyan premium nebula", MotionIntent: "calm orbiting energy"},
	}
	payload, _ := json.Marshal(dna)
	simulatedUsage := ai.Usage{InputTokens: 320, OutputTokens: 410, TotalTokens: 730}
	return &ai.StructuredResponse{Provider: ai.ProviderMock, Model: "mock-world-dna-v1", JSON: payload, Usage: simulatedUsage}, nil
}
