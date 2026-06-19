package providers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/ai/prompts"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/validation"
)

func mustMarshalDNA(t *testing.T, dna models.PersonalityDNA) json.RawMessage {
	t.Helper()
	payload, err := json.Marshal(dna)
	if err != nil {
		t.Fatalf("marshal DNA: %v", err)
	}
	return payload
}

func mustUnmarshalDNA(t *testing.T, payload json.RawMessage, dna *models.PersonalityDNA) {
	t.Helper()
	if err := json.Unmarshal(payload, dna); err != nil {
		t.Fatalf("unmarshal DNA: %v", err)
	}
}

func mockPromptFor(input models.WorldInput) ai.StructuredRequest {
	return ai.StructuredRequest{UserPrompt: prompts.WorldDNAUserPrompt(input)}
}

func baseMockInput() models.WorldInput {
	return models.WorldInput{
		Nickname:            "Neo",
		Role:                "Explorer",
		Interests:           []string{"Technology", "Design", "AI"},
		Traits:              []string{"curious", "builder", "focused"},
		Goal:                "Build a beautiful AI product",
		Mood:                "focused",
		FavoriteColors:      []string{"#8B5CF6"},
		PreferredWorldStyle: "cosmic-galaxy",
	}
}

// Every preset must produce a DNA that passes the same validator the
// orchestrator runs, regardless of which one the random selection returns.
func TestEveryPresetProducesValidDNA(t *testing.T) {
	profile := mockProfile{
		Interests:           []string{"Technology", "Design", "AI"},
		Traits:              []string{"curious", "builder", "focused"},
		PreferredWorldStyle: "nebula",
	}
	groups := map[string][]personalityDNAPreset{"balanced": balancedPresets}
	for mood, group := range presetsByMood {
		groups[mood] = group
	}
	for groupName, group := range groups {
		for presetIndex, preset := range group {
			dna := buildDNAFromPreset(preset, profile)
			payload := mustMarshalDNA(t, dna)
			if _, err := validation.ValidatePersonalityDNA(payload); err != nil {
				t.Fatalf("preset %s[%d] (%q) produced invalid DNA: %v", groupName, presetIndex, preset.Archetype, err)
			}
		}
	}
}

func TestMockGeneratesValidDNAForEveryMood(t *testing.T) {
	provider := NewMock()
	for _, mood := range []string{"focused", "dreamy", "energetic", "reflective", "futuristic calm", "curious"} {
		input := baseMockInput()
		input.Mood = mood
		response, err := provider.GenerateStructured(context.Background(), mockPromptFor(input))
		if err != nil {
			t.Fatalf("mood %q: GenerateStructured failed: %v", mood, err)
		}
		if _, err := validation.ValidatePersonalityDNA(response.JSON); err != nil {
			t.Fatalf("mood %q: produced invalid DNA: %v", mood, err)
		}
	}
}

func TestMockSelectsPresetGroupFromMood(t *testing.T) {
	dreamyArchetypes := map[string]bool{}
	for _, preset := range presetsByMood["dreamy"] {
		dreamyArchetypes[preset.Archetype] = true
	}
	provider := NewMock()
	input := baseMockInput()
	input.Mood = "dreamy"
	// Selection is random within the group, so sample repeatedly and require
	// every result to belong to the dreamy group.
	for attempt := 0; attempt < 30; attempt++ {
		response, err := provider.GenerateStructured(context.Background(), mockPromptFor(input))
		if err != nil {
			t.Fatalf("GenerateStructured failed: %v", err)
		}
		var dna models.PersonalityDNA
		mustUnmarshalDNA(t, response.JSON, &dna)
		if !dreamyArchetypes[dna.Archetype] {
			t.Fatalf("expected a dreamy-group archetype, got %q", dna.Archetype)
		}
	}
}

func TestMockNamesPlanetsFromInterests(t *testing.T) {
	provider := NewMock()
	input := baseMockInput()
	input.Interests = []string{"Technology", "Design", "AI"}

	response, err := provider.GenerateStructured(context.Background(), mockPromptFor(input))
	if err != nil {
		t.Fatalf("GenerateStructured failed: %v", err)
	}
	var dna models.PersonalityDNA
	mustUnmarshalDNA(t, response.JSON, &dna)

	if len(dna.Planets) < 3 {
		t.Fatalf("expected at least 3 planets, got %d", len(dna.Planets))
	}
	for planetIndex, interest := range input.Interests {
		if dna.Planets[planetIndex].Name != interest {
			t.Fatalf("planet %d: expected name %q, got %q", planetIndex, interest, dna.Planets[planetIndex].Name)
		}
		if dna.Planets[planetIndex].Type != interestPlanetType {
			t.Fatalf("planet %d: expected type %q, got %q", planetIndex, interestPlanetType, dna.Planets[planetIndex].Type)
		}
	}
}

func TestMockThemeFollowsPreferredStyle(t *testing.T) {
	provider := NewMock()
	input := baseMockInput()
	input.PreferredWorldStyle = "aurora"

	response, err := provider.GenerateStructured(context.Background(), mockPromptFor(input))
	if err != nil {
		t.Fatalf("GenerateStructured failed: %v", err)
	}
	var dna models.PersonalityDNA
	mustUnmarshalDNA(t, response.JSON, &dna)
	if dna.VisualHints.Theme != "aurora" {
		t.Fatalf("expected theme to follow preferred style 'aurora', got %q", dna.VisualHints.Theme)
	}
}

func TestMockClampsPlanetCountToMaximum(t *testing.T) {
	provider := NewMock()
	input := baseMockInput()
	input.Interests = []string{"a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"}

	response, err := provider.GenerateStructured(context.Background(), mockPromptFor(input))
	if err != nil {
		t.Fatalf("GenerateStructured failed: %v", err)
	}
	var dna models.PersonalityDNA
	mustUnmarshalDNA(t, response.JSON, &dna)
	if len(dna.Planets) != mockPlanetMaximumCount {
		t.Fatalf("expected planet count clamped to %d, got %d", mockPlanetMaximumCount, len(dna.Planets))
	}
}

func TestMockDefaultsThemeForUnsupportedStyle(t *testing.T) {
	if theme := themeForStyle("not-a-real-style"); theme != defaultMockTheme {
		t.Fatalf("expected fallback theme %q, got %q", defaultMockTheme, theme)
	}
	if theme := themeForStyle(""); theme != defaultMockTheme {
		t.Fatalf("expected fallback theme %q for empty style, got %q", defaultMockTheme, theme)
	}
}
