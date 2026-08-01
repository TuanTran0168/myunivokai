package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
)

// The golden fixtures are the compatibility contract in executable form
// (described by contracts/schemas/world-scene-config.schema.json, which the
// contracts module validates these files against): saved universes must render
// forever, so a byte-level change to what the builder emits for an existing seed
// is a BREAKING change. Nature has had this since its own contract froze; this
// is the same guard for Universe, which had none — its scene schema was only
// ever checked for being parseable JSON.
//
// If this test fails after an intentional contract change, bump
// sceneConfigSchemaVersion, keep a reader for the old version, and regenerate
// deliberately with:
//
//	UPDATE_GOLDEN=1 go test ./internal/services -run TestUniverseGoldenFixtures
//
// The cases cover every theme in the contract, because the theme selects the
// palette, sky, belt, sun and post-processing grade — one theme would fix only a
// fifth of the surface.
var universeGoldenCases = []struct {
	Name        string
	Seed        string
	Theme       string
	Mood        string
	PlanetCount int
}{
	{Name: "cosmic-galaxy-focused", Seed: "UNI-GOLDEN-COSMIC", Theme: "cosmic-galaxy", Mood: "focused", PlanetCount: 5},
	{Name: "nebula-dreamy", Seed: "UNI-GOLDEN-NEBULA", Theme: "nebula", Mood: "dreamy", PlanetCount: 7},
	{Name: "crystal-reflective", Seed: "UNI-GOLDEN-CRYSTAL", Theme: "crystal", Mood: "reflective", PlanetCount: 3},
	{Name: "aurora-energetic", Seed: "UNI-GOLDEN-AURORA", Theme: "aurora", Mood: "energetic", PlanetCount: 6},
	{Name: "cyber-orbit-curious", Seed: "UNI-GOLDEN-CYBER", Theme: "cyber-orbit", Mood: "curious", PlanetCount: 4},
}

func TestUniverseGoldenFixtures(t *testing.T) {
	builder := NewWorldConfigBuilder()
	updateGolden := os.Getenv("UPDATE_GOLDEN") == "1"
	for _, goldenCase := range universeGoldenCases {
		config := builder.Build(buildUniverseGoldenInput(goldenCase.Seed, goldenCase.Theme, goldenCase.Mood, goldenCase.PlanetCount))
		got, err := json.MarshalIndent(config, "", "  ")
		if err != nil {
			t.Fatalf("marshal config for %s: %v", goldenCase.Name, err)
		}
		got = append(got, '\n')
		fixturePath := filepath.Join("testdata", "universe-golden-"+goldenCase.Name+".json")
		if updateGolden {
			if err := os.MkdirAll("testdata", 0o755); err != nil {
				t.Fatalf("create testdata dir: %v", err)
			}
			if err := os.WriteFile(fixturePath, got, 0o644); err != nil {
				t.Fatalf("write golden %s: %v", fixturePath, err)
			}
			continue
		}
		want, err := os.ReadFile(fixturePath)
		if err != nil {
			t.Fatalf("read golden %s (create it with UPDATE_GOLDEN=1): %v", fixturePath, err)
		}
		// The repo checks files out with CRLF on Windows; normalize before the
		// byte comparison so the contract check is about content, not line
		// endings.
		normalizedWant := strings.ReplaceAll(string(want), "\r\n", "\n")
		if string(got) != normalizedWant {
			t.Fatalf("golden fixture %s no longer matches the builder output — this is a breaking contract change; bump sceneConfigSchemaVersion (or regenerate deliberately with UPDATE_GOLDEN=1)", fixturePath)
		}
	}
}

// Only the fields the builder actually reads are populated — mood, favorite
// colors, scene name, archetype, quote, theme and planets. Filling TraitScores
// or EnergySignature here would imply the output depends on them when it does
// not, and a fixture that implies coverage it lacks is worse than a small one.
func buildUniverseGoldenInput(seedValue, theme, mood string, planetCount int) BuildWorldConfigInput {
	planetNames := []string{"Origin", "Craft", "Signal", "Depth", "Drift", "Ember", "Vantage"}
	planets := make([]models.DNAPlanet, 0, planetCount)
	for planetIndex := 0; planetIndex < planetCount; planetIndex++ {
		planets = append(planets, models.DNAPlanet{
			Key:     strings.ToLower(planetNames[planetIndex%len(planetNames)]),
			Name:    planetNames[planetIndex%len(planetNames)],
			Meaning: "Facet " + planetNames[planetIndex%len(planetNames)],
			// Descending energies so orbit ordering and size mapping are
			// exercised rather than every planet landing in the same bucket.
			Energy: 92 - planetIndex*9,
		})
	}
	return BuildWorldConfigInput{
		Seed: seedValue,
		Input: models.VisualIntent{
			Mood:                mood,
			FavoriteColors:      []string{"#8B5CF6", "#06B6D4"},
			PreferredWorldStyle: theme,
		},
		DNA: models.PersonalityDNA{
			Archetype:   "Builder Explorer",
			SceneName:   "Quiet Constellation",
			Quote:       "Build the map while walking it.",
			VisualHints: models.VisualHints{Theme: theme},
			Planets:     planets,
		},
	}
}
