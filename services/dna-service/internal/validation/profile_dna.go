package validation

import (
	"encoding/json"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

func ValidateProfileDNA(rawDNA json.RawMessage) (contracts.ProfileDNA, error) {
	var profileDNA contracts.ProfileDNA
	if err := json.Unmarshal(rawDNA, &profileDNA); err != nil {
		return contracts.ProfileDNA{}, err
	}
	if profileDNA.SchemaVersion == "" {
		profileDNA.SchemaVersion = contracts.SchemaVersionV1
	}
	if err := profileDNA.Validate(); err != nil {
		return contracts.ProfileDNA{}, err
	}
	return profileDNA, nil
}

func ProfileDNASchema() map[string]any {
	scoreSchema := map[string]any{"type": "integer", "minimum": 0, "maximum": 100}
	return map[string]any{
		"type":                 "object",
		"required":             []string{"schemaVersion", "archetype", "sceneName", "quote", "shortNarrative", "traitScores", "energySignature", "facets", "visualHints"},
		"additionalProperties": false,
		"properties": map[string]any{
			"schemaVersion":  map[string]any{"type": "string"},
			"archetype":      map[string]any{"type": "string"},
			"sceneName":      map[string]any{"type": "string"},
			"quote":          map[string]any{"type": "string"},
			"shortNarrative": map[string]any{"type": "string"},
			"traitScores": objectSchema([]string{"creativity", "discipline", "curiosity", "energy", "focus"}, map[string]any{
				"creativity": scoreSchema,
				"discipline": scoreSchema,
				"curiosity":  scoreSchema,
				"energy":     scoreSchema,
				"focus":      scoreSchema,
			}),
			"energySignature": objectSchema([]string{"primary", "secondary", "intensity"}, map[string]any{
				"primary":   map[string]any{"type": "string"},
				"secondary": map[string]any{"type": "string"},
				"intensity": scoreSchema,
			}),
			"facets": map[string]any{
				"type":     "array",
				"minItems": 3,
				"maxItems": 7,
				"items": objectSchema([]string{"key", "name", "kind", "meaning", "energy"}, map[string]any{
					"key":     map[string]any{"type": "string"},
					"name":    map[string]any{"type": "string"},
					"kind":    map[string]any{"type": "string"},
					"meaning": map[string]any{"type": "string"},
					"energy":  scoreSchema,
				}),
			},
			"visualHints": objectSchema([]string{"theme", "coreSymbol", "paletteIntent", "motionIntent"}, map[string]any{
				"theme":         map[string]any{"type": "string"},
				"coreSymbol":    map[string]any{"type": "string"},
				"paletteIntent": map[string]any{"type": "string"},
				"motionIntent":  map[string]any{"type": "string"},
			}),
		},
	}
}

func objectSchema(required []string, properties map[string]any) map[string]any {
	return map[string]any{
		"type":                 "object",
		"required":             required,
		"additionalProperties": false,
		"properties":           properties,
	}
}
