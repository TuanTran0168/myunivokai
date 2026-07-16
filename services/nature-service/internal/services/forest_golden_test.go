package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The golden fixtures are the compatibility contract in executable form
// (mirrored descriptively by contracts/scenes/forest-scene-config.schema.json):
// saved forests must render forever, so a byte-level change to what the
// builder emits for an existing seed is a BREAKING change. If this test fails
// after an intentional contract change, bump forestSchemaVersion, keep a
// reader for the old version, and regenerate deliberately with:
//
//	UPDATE_GOLDEN=1 go test ./internal/services -run TestGoldenFixtures
var goldenCases = []struct {
	Name          string
	Seed          string
	Mood          string
	LandmarkCount int
}{
	{Name: "reflective", Seed: "NAT-GOLDEN-REFLECTIVE", Mood: "reflective", LandmarkCount: 5},
	{Name: "focused", Seed: "NAT-GOLDEN-FOCUSED", Mood: "focused", LandmarkCount: 3},
	{Name: "dreamy", Seed: "NAT-GOLDEN-DREAMY", Mood: "dreamy", LandmarkCount: 7},
	{Name: "energetic", Seed: "NAT-GOLDEN-ENERGETIC", Mood: "energetic", LandmarkCount: 4},
}

func TestGoldenFixtures(t *testing.T) {
	builder := NewForestConfigBuilder()
	updateGolden := os.Getenv("UPDATE_GOLDEN") == "1"
	for _, goldenCase := range goldenCases {
		config := builder.Build(buildTestInput(goldenCase.Seed, goldenCase.Mood, goldenCase.LandmarkCount))
		got, err := json.MarshalIndent(config, "", "  ")
		if err != nil {
			t.Fatalf("marshal config for %s: %v", goldenCase.Name, err)
		}
		got = append(got, '\n')
		fixturePath := filepath.Join("testdata", "forest-golden-"+goldenCase.Name+".json")
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
			t.Fatalf("golden fixture %s no longer matches the builder output — this is a breaking contract change; bump forestSchemaVersion (or regenerate deliberately with UPDATE_GOLDEN=1)", fixturePath)
		}
	}
}
