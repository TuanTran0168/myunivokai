package validation

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

func validInput() models.WorldInput {
	return models.WorldInput{
		Nickname:            "Tuan",
		Interests:           []string{"hiking", "music", "photography"},
		Traits:              []string{"curious", "calm", "kind"},
		Goal:                "Grow a quiet forest of my own.",
		Mood:                "reflective",
		FavoriteColors:      []string{"#8B5CF6"},
		PreferredWorldStyle: "aurora",
	}
}

func TestValidateWorldInputAcceptsValidInput(t *testing.T) {
	if details := ValidateWorldInput(validInput()); len(details) > 0 {
		t.Fatalf("valid input rejected: %+v", details)
	}
}

func TestValidateWorldInputReportsFieldErrors(t *testing.T) {
	input := validInput()
	input.Nickname = "x"
	input.Interests = []string{"go"}
	input.Mood = "chaotic"
	input.FavoriteColors = []string{"purple"}
	input.PreferredWorldStyle = "solarpunk"
	details := ValidateWorldInput(input)
	expectedFields := []string{"nickname", "interests", "mood", "favoriteColors.0", "preferredWorldStyle"}
	for _, expectedField := range expectedFields {
		found := false
		for _, detail := range details {
			if detail.Field == expectedField {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("expected a validation detail for %q, got %+v", expectedField, details)
		}
	}
}

func validDNAJSON(t *testing.T, mutate func(map[string]any)) json.RawMessage {
	t.Helper()
	dna := map[string]any{
		"schemaVersion":  "1.0",
		"archetype":      "Grove Keeper",
		"sceneName":      "The Amberfall Sanctuary",
		"quote":          "I tend what matters.",
		"shortNarrative": "A thoughtful caretaker.",
		"traitScores":    map[string]any{"creativity": 80, "discipline": 80, "curiosity": 80, "energy": 80, "focus": 80},
		"energySignature": map[string]any{
			"primary": "reflective", "secondary": "focused", "intensity": 75,
		},
		"landmarks": []map[string]any{
			{"key": "hiking", "name": "Hiking", "type": "Interest Landmark", "meaning": "Trails.", "energy": 70},
			{"key": "music", "name": "Music", "type": "Interest Landmark", "meaning": "Rhythm.", "energy": 75},
			{"key": "calm", "name": "Calm", "type": "Trait Landmark", "meaning": "Stillness.", "energy": 80},
		},
		"visualHints": map[string]any{"theme": "aurora", "coreSymbol": "lantern", "paletteIntent": "calm", "motionIntent": "slow"},
	}
	if mutate != nil {
		mutate(dna)
	}
	payload, err := json.Marshal(dna)
	if err != nil {
		t.Fatalf("marshal test DNA: %v", err)
	}
	return payload
}

func TestValidateNatureDNAAcceptsValidDNA(t *testing.T) {
	dna, err := ValidateNatureDNA(validDNAJSON(t, nil))
	if err != nil {
		t.Fatalf("valid DNA rejected: %v", err)
	}
	if len(dna.Landmarks) != 3 {
		t.Fatalf("landmarks lost in validation")
	}
}

func TestValidateNatureDNADefaultsSchemaVersion(t *testing.T) {
	dna, err := ValidateNatureDNA(validDNAJSON(t, func(m map[string]any) { m["schemaVersion"] = "" }))
	if err != nil {
		t.Fatalf("DNA without schemaVersion rejected: %v", err)
	}
	if dna.SchemaVersion != "1.0" {
		t.Fatalf("schemaVersion must default to 1.0, got %q", dna.SchemaVersion)
	}
}

func TestValidateNatureDNARejectsBadContent(t *testing.T) {
	cases := map[string]func(map[string]any){
		"too few landmarks": func(m map[string]any) {
			m["landmarks"] = []map[string]any{{"key": "a", "name": "Ab", "type": "t", "meaning": "m", "energy": 50}}
		},
		"energy out of range": func(m map[string]any) {
			m["landmarks"].([]map[string]any)[0]["energy"] = 101
		},
		"unsupported theme": func(m map[string]any) {
			m["visualHints"].(map[string]any)["theme"] = "solarpunk"
		},
		"quote too long": func(m map[string]any) {
			m["quote"] = strings.Repeat("a", 101)
		},
	}
	for name, mutate := range cases {
		if _, err := ValidateNatureDNA(validDNAJSON(t, mutate)); err == nil {
			t.Fatalf("case %q: invalid DNA accepted", name)
		}
	}
}
