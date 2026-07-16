package providers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/ai/prompts"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

func TestPresetGroupForMood(t *testing.T) {
	for mood := range presetsByMood {
		group := presetGroupForMood(mood)
		if len(group) == 0 {
			t.Fatalf("mood %q must resolve a preset group", mood)
		}
	}
	if len(presetGroupForMood("  REFLECTIVE ")) != len(presetsByMood["reflective"]) {
		t.Fatalf("mood matching must normalize case and whitespace")
	}
	if len(presetGroupForMood("futuristic calm")) != len(balancedPresets) {
		t.Fatalf("unmapped moods must fall back to the balanced presets")
	}
}

func TestLandmarksAreNamedFromInterestsAndTraits(t *testing.T) {
	preset := presetsByMood["dreamy"][0]
	profile := mockProfile{
		Interests: []string{"Photography", "Hiking", "photography"},
		Traits:    []string{"Curious", "Kind"},
	}
	dna := buildDNAFromPreset(preset, profile)
	if len(dna.Landmarks) != 4 {
		t.Fatalf("expected 4 landmarks (dedupe removes the repeated interest), got %d", len(dna.Landmarks))
	}
	if dna.Landmarks[0].Name != "Photography" || dna.Landmarks[0].Type != interestLandmarkType {
		t.Fatalf("first landmark must come from the first interest, got %+v", dna.Landmarks[0])
	}
	if dna.Landmarks[2].Type != traitLandmarkType {
		t.Fatalf("trait-sourced landmarks must carry the trait type")
	}
	for _, landmark := range dna.Landmarks {
		if landmark.Energy < mockLandmarkMinimumEnergy || landmark.Energy >= mockLandmarkMinimumEnergy+mockLandmarkEnergyRange {
			t.Fatalf("landmark energy %d out of bounds", landmark.Energy)
		}
	}
}

func TestLandmarksFallBackWhenProfileIsEmpty(t *testing.T) {
	dna := buildDNAFromPreset(presetsByMood["focused"][0], mockProfile{})
	if len(dna.Landmarks) != mockLandmarkMinimumCount {
		t.Fatalf("empty profile must fall back to %d default landmarks, got %d", mockLandmarkMinimumCount, len(dna.Landmarks))
	}
	if dna.Landmarks[0].Name != defaultLandmarkNames[0] {
		t.Fatalf("fallback landmarks must use the default names")
	}
}

func TestThemeForStyle(t *testing.T) {
	if themeForStyle("aurora") != "aurora" {
		t.Fatalf("supported styles must pass through")
	}
	if themeForStyle("solarpunk") != defaultMockTheme {
		t.Fatalf("unsupported styles must fall back to %q", defaultMockTheme)
	}
}

func TestGenerateStructuredReadsThePromptProfile(t *testing.T) {
	input := models.WorldInput{
		Nickname:            "Tuan",
		Interests:           []string{"hiking", "music", "photography"},
		Traits:              []string{"curious", "calm", "kind"},
		Goal:                "Grow a quiet forest of my own.",
		Mood:                "dreamy",
		FavoriteColors:      []string{"#8B5CF6"},
		PreferredWorldStyle: "crystal",
	}
	response, err := NewMock().GenerateStructured(context.Background(), ai.StructuredRequest{UserPrompt: prompts.ForestDNAUserPrompt(input)})
	if err != nil {
		t.Fatalf("GenerateStructured: %v", err)
	}
	var dna models.NatureDNA
	if err := json.Unmarshal(response.JSON, &dna); err != nil {
		t.Fatalf("mock output must be valid NatureDNA JSON: %v", err)
	}
	if len(dna.Landmarks) < 3 || len(dna.Landmarks) > 7 {
		t.Fatalf("mock must produce 3-7 landmarks, got %d", len(dna.Landmarks))
	}
	if dna.Landmarks[0].Name != "hiking" {
		t.Fatalf("landmarks must be named from the prompt's interests, got %q", dna.Landmarks[0].Name)
	}
	if dna.VisualHints.Theme != "crystal" {
		t.Fatalf("theme must follow the preferred world style, got %q", dna.VisualHints.Theme)
	}
}
