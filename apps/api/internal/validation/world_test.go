package validation

import (
	"encoding/json"
	"testing"

	"github.com/myunivokai/myunivokai/apps/api/internal/models"
)

func TestValidateWorldInput(t *testing.T) {
	input := models.WorldInput{
		Nickname:            "Tuan",
		Interests:           []string{"coding", "travel", "photo"},
		Traits:              []string{"curious", "builder", "focused"},
		Goal:                "Build a beautiful AI product",
		Mood:                "futuristic calm",
		FavoriteColors:      []string{"#8B5CF6", "#06B6D4"},
		PreferredWorldStyle: "cosmic-galaxy",
	}
	if details := ValidateWorldInput(input); len(details) != 0 {
		t.Fatalf("expected valid input, got %+v", details)
	}
	input.FavoriteColors = []string{"purple"}
	if details := ValidateWorldInput(input); len(details) == 0 {
		t.Fatalf("expected invalid color")
	}
}

func TestValidatePersonalityDNA(t *testing.T) {
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
	if _, err := ValidatePersonalityDNA(raw); err != nil {
		t.Fatalf("expected valid dna: %v", err)
	}
	dna.TraitScores.Focus = 101
	raw, _ = json.Marshal(dna)
	if _, err := ValidatePersonalityDNA(raw); err == nil {
		t.Fatalf("expected invalid trait score")
	}
}
