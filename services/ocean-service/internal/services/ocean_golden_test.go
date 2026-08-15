package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The golden fixtures are the compatibility contract in executable form
// (mirrored descriptively by contracts/scenes/ocean-scene-config.schema.json):
// saved oceans must render forever, so a byte-level change to what the builder
// emits for an existing seed is a BREAKING change. If this test fails after an
// intentional contract change, bump oceanSchemaVersion, keep a reader for the
// old version, and regenerate deliberately with:
//
//	UPDATE_GOLDEN=1 go test ./internal/services -run TestGoldenFixtures
//
// These same four files pin the FRONTEND preview builder
// (apps/myunivokai-web/src/lib/oceanScene.ts). The depth curve is implemented
// twice — once in Go and once in TypeScript — and a shared fixture is the only
// thing that stops the two drifting.
var goldenCases = []struct {
	Name          string
	Seed          string
	Mood          string
	LandmarkCount int
}{
	// The seeds are chosen, not arbitrary: between them the four cases land in all
	// three depth zones and cover both a world with a giant and a world without.
	// TestGoldenFixturesCoverEveryDepthZone below is what keeps that true.
	//
	//	reflective  OCN-GOLDEN-DEEP       abyss           ~2431 m   no giant
	//	focused     OCN-GOLDEN-TWILIGHT   twilightReach    ~751 m   giant
	//	dreamy      OCN-GOLDEN-BLOOM      twilightReach    ~224 m   no giant
	//	energetic   OCN-GOLDEN-SURGE      sunlitShallows    ~35 m   giant
	{Name: "reflective", Seed: "OCN-GOLDEN-DEEP", Mood: "reflective", LandmarkCount: 5},
	{Name: "focused", Seed: "OCN-GOLDEN-TWILIGHT", Mood: "focused", LandmarkCount: 3},
	{Name: "dreamy", Seed: "OCN-GOLDEN-BLOOM", Mood: "dreamy", LandmarkCount: 7},
	{Name: "energetic", Seed: "OCN-GOLDEN-SURGE", Mood: "energetic", LandmarkCount: 4},
}

func TestGoldenFixtures(t *testing.T) {
	builder := NewOceanConfigBuilder()
	updateGolden := os.Getenv("UPDATE_GOLDEN") == "1"
	for _, goldenCase := range goldenCases {
		config := builder.Build(buildTestInput(goldenCase.Seed, goldenCase.Mood, goldenCase.LandmarkCount))
		got, err := json.MarshalIndent(config, "", "  ")
		if err != nil {
			t.Fatalf("marshal config for %s: %v", goldenCase.Name, err)
		}
		got = append(got, '\n')
		fixturePath := filepath.Join("testdata", "ocean-golden-"+goldenCase.Name+".json")
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
			t.Fatalf("golden fixture %s no longer matches the builder output — this is a breaking contract change; bump oceanSchemaVersion (or regenerate deliberately with UPDATE_GOLDEN=1)", fixturePath)
		}
	}
}

// The four goldens must not all land in one zone, or they would pin a third of
// the family and quietly stop covering the rest of it.
func TestGoldenFixturesCoverEveryDepthZone(t *testing.T) {
	builder := NewOceanConfigBuilder()
	zones := map[string]bool{}
	for _, goldenCase := range goldenCases {
		zones[builder.Build(buildTestInput(goldenCase.Seed, goldenCase.Mood, goldenCase.LandmarkCount)).Depth.Zone] = true
	}
	for _, zone := range zoneKindsInOrder {
		if !zones[zone] {
			t.Fatalf("no golden fixture lands in %q; the goldens pin only %v — pick different seeds", zone, zones)
		}
	}
}
