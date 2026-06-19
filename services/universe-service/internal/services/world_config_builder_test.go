package services

import (
	"reflect"
	"testing"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
)

func TestWorldConfigBuilderDeterministic(t *testing.T) {
	builder := NewWorldConfigBuilder()
	input := BuildWorldConfigInput{
		Seed:  "WLD-ABC1234567",
		Input: models.WorldInput{FavoriteColors: []string{"#8B5CF6", "#06B6D4"}},
		DNA: models.PersonalityDNA{
			Archetype:   "Builder Explorer",
			SceneName:   "Galaxy",
			Quote:       "Build.",
			VisualHints: models.VisualHints{Theme: "cosmic-galaxy"},
			Planets: []models.DNAPlanet{
				{Key: "a", Name: "A", Meaning: "A", Energy: 80},
				{Key: "b", Name: "B", Meaning: "B", Energy: 70},
				{Key: "c", Name: "C", Meaning: "C", Energy: 60},
			},
		},
	}
	a := builder.Build(input)
	b := builder.Build(input)
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("expected deterministic config")
	}
	if len(a.Planets) != 3 {
		t.Fatalf("expected 3 planets")
	}
	if a.Particles.DesktopCount < 600 || a.Particles.DesktopCount > 1500 {
		t.Fatalf("desktop particle count out of bounds")
	}
}

func TestWorldConfigBuilderMoodAffectsScene(t *testing.T) {
	builder := NewWorldConfigBuilder()
	buildForMood := func(mood string) models.WorldSceneConfig {
		return builder.Build(BuildWorldConfigInput{
			Seed:  "WLD-ABC1234567",
			Input: models.WorldInput{FavoriteColors: []string{"#8B5CF6", "#06B6D4"}, Mood: mood},
			DNA: models.PersonalityDNA{
				Archetype:   "Builder Explorer",
				SceneName:   "Galaxy",
				Quote:       "Build.",
				VisualHints: models.VisualHints{Theme: "cosmic-galaxy"},
				Planets: []models.DNAPlanet{
					{Key: "a", Name: "A", Meaning: "A", Energy: 80},
					{Key: "b", Name: "B", Meaning: "B", Energy: 70},
					{Key: "c", Name: "C", Meaning: "C", Energy: 60},
				},
			},
		})
	}

	neutral := buildForMood("")
	energetic := buildForMood("energetic")
	reflective := buildForMood("reflective")

	if neutral.Palette.Background != defaultSceneBackgroundColor {
		t.Fatalf("expected neutral background %q, got %q", defaultSceneBackgroundColor, neutral.Palette.Background)
	}
	if energetic.Palette.Background == reflective.Palette.Background {
		t.Fatal("expected different backgrounds for energetic vs reflective moods")
	}
	if energetic.PostFX.BloomIntensity <= reflective.PostFX.BloomIntensity {
		t.Fatalf("expected energetic bloom (%v) > reflective bloom (%v)", energetic.PostFX.BloomIntensity, reflective.PostFX.BloomIntensity)
	}
	if energetic.Particles.DesktopCount <= reflective.Particles.DesktopCount {
		t.Fatalf("expected energetic particles (%d) > reflective (%d)", energetic.Particles.DesktopCount, reflective.Particles.DesktopCount)
	}
	if energetic.Planets[0].OrbitSpeed <= reflective.Planets[0].OrbitSpeed {
		t.Fatalf("expected energetic orbit speed (%v) > reflective (%v)", energetic.Planets[0].OrbitSpeed, reflective.Planets[0].OrbitSpeed)
	}
}
