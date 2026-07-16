package validation

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/httpx"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// Mirrors universe-service's allowed moods so one create form can feed both
// services with identical payloads.
var allowedMoods = map[string]bool{
	"futuristic calm": true,
	"focused":         true,
	"dreamy":          true,
	"energetic":       true,
	"reflective":      true,
	"curious":         true,
}

// Mirrors universe-service's allowed themes (style tokens the create form
// sends today). A nature-specific style list can replace this once the
// frontend family picker exists.
var allowedThemes = map[string]bool{
	"cosmic-galaxy": true,
	"nebula":        true,
	"crystal":       true,
	"aurora":        true,
	"cyber-orbit":   true,
}

func ValidateWorldInput(input models.WorldInput) []httpx.ErrorDetail {
	var details []httpx.ErrorDetail
	if length(input.Nickname) < 2 || length(input.Nickname) > 32 {
		details = append(details, field("nickname", "Nickname must be 2-32 characters."))
	}
	if input.Role != "" && length(input.Role) > 80 {
		details = append(details, field("role", "Role must be 80 characters or fewer."))
	}
	if len(input.Interests) < 3 || len(input.Interests) > 8 {
		details = append(details, field("interests", "Choose 3-8 interests."))
	}
	for i, item := range input.Interests {
		if length(item) < 2 || length(item) > 32 {
			details = append(details, field(fmt.Sprintf("interests.%d", i), "Interest must be 2-32 characters."))
		}
	}
	if len(input.Traits) < 3 || len(input.Traits) > 6 {
		details = append(details, field("traits", "Choose 3-6 traits."))
	}
	for i, item := range input.Traits {
		if length(item) < 2 || length(item) > 32 {
			details = append(details, field(fmt.Sprintf("traits.%d", i), "Trait must be 2-32 characters."))
		}
	}
	if length(input.Goal) < 10 || length(input.Goal) > 220 {
		details = append(details, field("goal", "Goal must be 10-220 characters."))
	}
	if input.Challenge != "" && length(input.Challenge) > 220 {
		details = append(details, field("challenge", "Challenge must be 220 characters or fewer."))
	}
	if !allowedMoods[strings.ToLower(strings.TrimSpace(input.Mood))] {
		details = append(details, field("mood", "Mood is not supported."))
	}
	if len(input.FavoriteColors) < 1 || len(input.FavoriteColors) > 4 {
		details = append(details, field("favoriteColors", "Choose 1-4 favorite colors."))
	}
	for i, color := range input.FavoriteColors {
		if !hexColor.MatchString(color) {
			details = append(details, field(fmt.Sprintf("favoriteColors.%d", i), "Color must be a hex value like #8B5CF6."))
		}
	}
	if !allowedThemes[strings.ToLower(strings.TrimSpace(input.PreferredWorldStyle))] {
		details = append(details, field("preferredWorldStyle", "World style is not supported."))
	}
	return details
}

func NormalizeWorldInput(input models.WorldInput) models.WorldInput {
	input.Nickname = strings.TrimSpace(input.Nickname)
	input.Role = strings.TrimSpace(input.Role)
	input.Goal = strings.TrimSpace(input.Goal)
	input.Challenge = strings.TrimSpace(input.Challenge)
	input.Mood = strings.ToLower(strings.TrimSpace(input.Mood))
	input.PreferredWorldStyle = strings.ToLower(strings.TrimSpace(input.PreferredWorldStyle))
	input.Interests = trimSlice(input.Interests)
	input.Traits = trimSlice(input.Traits)
	input.FavoriteColors = trimSlice(input.FavoriteColors)
	return input
}

func ValidateNatureDNA(raw json.RawMessage) (models.NatureDNA, error) {
	var dna models.NatureDNA
	if err := json.Unmarshal(raw, &dna); err != nil {
		return dna, err
	}
	if length(dna.Archetype) < 2 || length(dna.Archetype) > 40 {
		return dna, fmt.Errorf("archetype must be 2-40 characters")
	}
	if length(dna.SceneName) < 3 || length(dna.SceneName) > 80 {
		return dna, fmt.Errorf("sceneName must be 3-80 characters")
	}
	if length(dna.Quote) > 100 {
		return dna, fmt.Errorf("quote must be 100 characters or fewer")
	}
	if length(dna.ShortNarrative) > 240 {
		return dna, fmt.Errorf("shortNarrative must be 240 characters or fewer")
	}
	for name, value := range map[string]int{
		"creativity": dna.TraitScores.Creativity,
		"discipline": dna.TraitScores.Discipline,
		"curiosity":  dna.TraitScores.Curiosity,
		"energy":     dna.TraitScores.Energy,
		"focus":      dna.TraitScores.Focus,
	} {
		if value < 0 || value > 100 {
			return dna, fmt.Errorf("traitScores.%s must be 0-100", name)
		}
	}
	if dna.EnergySignature.Intensity < 0 || dna.EnergySignature.Intensity > 100 {
		return dna, fmt.Errorf("energySignature.intensity must be 0-100")
	}
	if len(dna.Landmarks) < 3 || len(dna.Landmarks) > 7 {
		return dna, fmt.Errorf("landmarks must contain 3-7 items")
	}
	for i, landmark := range dna.Landmarks {
		if length(landmark.Name) < 2 || length(landmark.Name) > 40 {
			return dna, fmt.Errorf("landmarks.%d.name must be 2-40 characters", i)
		}
		if length(landmark.Meaning) > 180 {
			return dna, fmt.Errorf("landmarks.%d.meaning must be 180 characters or fewer", i)
		}
		if landmark.Energy < 0 || landmark.Energy > 100 {
			return dna, fmt.Errorf("landmarks.%d.energy must be 0-100", i)
		}
	}
	if !allowedThemes[strings.ToLower(strings.TrimSpace(dna.VisualHints.Theme))] {
		return dna, fmt.Errorf("visualHints.theme is not supported")
	}
	if dna.SchemaVersion == "" {
		dna.SchemaVersion = "1.0"
	}
	return dna, nil
}

// NatureDNASchema fully specifies every nested object, because OpenAI
// structured outputs in strict mode reject free-form objects: each object must
// list its properties, mark them all required, and set additionalProperties to
// false. Kept schema-compatible with the universe-service pattern so the
// real-AI round can reuse the provider adapters unchanged.
func NatureDNASchema() map[string]any {
	traitScoreSchema := map[string]any{"type": "integer", "minimum": 0, "maximum": 100}
	return map[string]any{
		"type":                 "object",
		"required":             []string{"schemaVersion", "archetype", "sceneName", "quote", "shortNarrative", "traitScores", "energySignature", "landmarks", "visualHints"},
		"additionalProperties": false,
		"properties": map[string]any{
			"schemaVersion":  map[string]any{"type": "string"},
			"archetype":      map[string]any{"type": "string"},
			"sceneName":      map[string]any{"type": "string"},
			"quote":          map[string]any{"type": "string"},
			"shortNarrative": map[string]any{"type": "string"},
			"traitScores": map[string]any{
				"type":                 "object",
				"required":             []string{"creativity", "discipline", "curiosity", "energy", "focus"},
				"additionalProperties": false,
				"properties": map[string]any{
					"creativity": traitScoreSchema,
					"discipline": traitScoreSchema,
					"curiosity":  traitScoreSchema,
					"energy":     traitScoreSchema,
					"focus":      traitScoreSchema,
				},
			},
			"energySignature": map[string]any{
				"type":                 "object",
				"required":             []string{"primary", "secondary", "intensity"},
				"additionalProperties": false,
				"properties": map[string]any{
					"primary":   map[string]any{"type": "string"},
					"secondary": map[string]any{"type": "string"},
					"intensity": traitScoreSchema,
				},
			},
			"landmarks": map[string]any{
				"type":     "array",
				"minItems": 3,
				"maxItems": 7,
				"items": map[string]any{
					"type":                 "object",
					"required":             []string{"key", "name", "type", "meaning", "energy"},
					"additionalProperties": false,
					"properties": map[string]any{
						"key":     map[string]any{"type": "string"},
						"name":    map[string]any{"type": "string"},
						"type":    map[string]any{"type": "string"},
						"meaning": map[string]any{"type": "string"},
						"energy":  traitScoreSchema,
					},
				},
			},
			"visualHints": map[string]any{
				"type":                 "object",
				"required":             []string{"theme", "coreSymbol", "paletteIntent", "motionIntent"},
				"additionalProperties": false,
				"properties": map[string]any{
					"theme":         map[string]any{"type": "string"},
					"coreSymbol":    map[string]any{"type": "string"},
					"paletteIntent": map[string]any{"type": "string"},
					"motionIntent":  map[string]any{"type": "string"},
				},
			},
		},
	}
}

func field(name, message string) httpx.ErrorDetail {
	return httpx.ErrorDetail{Field: name, Message: message}
}

func length(value string) int {
	return len([]rune(strings.TrimSpace(value)))
}

func trimSlice(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
