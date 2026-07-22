package providers

import (
	"context"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai/prompts"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/validation"
)

func TestMockProviderProducesValidFamilyNeutralProfileDNA(t *testing.T) {
	input := contracts.WorldInput{
		Nickname: "Nova", Role: "Builder", Interests: []string{"AI", "Music", "Space"},
		Traits: []string{"curious", "calm", "focused"}, Goal: "Build a meaningful creative universe",
		Mood: "reflective", FavoriteColors: []string{"#8B5CF6"}, PreferredWorldStyle: "aurora",
	}
	response, err := NewMock().GenerateStructured(context.Background(), ai.StructuredRequest{UserPrompt: prompts.UserPrompt(input)})
	if err != nil {
		t.Fatal(err)
	}
	profileDNA, err := validation.ValidateProfileDNA(response.JSON)
	if err != nil {
		t.Fatalf("mock profile DNA is invalid: %v", err)
	}
	if profileDNA.VisualHints.Theme != "aurora" || len(profileDNA.Facets) < 3 {
		t.Fatalf("unexpected profile DNA: %+v", profileDNA)
	}
	for _, facet := range profileDNA.Facets {
		if facet.Kind != "interest" && facet.Kind != "trait" {
			t.Fatalf("facet leaks a renderer-specific kind: %+v", facet)
		}
	}
}
