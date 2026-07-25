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
		Input: models.VisualIntent{FavoriteColors: []string{"#8B5CF6", "#06B6D4"}},
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
			Input: models.VisualIntent{FavoriteColors: []string{"#8B5CF6", "#06B6D4"}, Mood: mood},
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

func buildSkyTestInput(theme string, mood string) BuildWorldConfigInput {
	return BuildWorldConfigInput{
		Seed:  "WLD-ABC1234567",
		Input: models.VisualIntent{FavoriteColors: []string{"#8B5CF6", "#06B6D4"}, Mood: mood},
		DNA: models.PersonalityDNA{
			Archetype:   "Builder Explorer",
			SceneName:   "Galaxy",
			Quote:       "Build.",
			VisualHints: models.VisualHints{Theme: theme},
			Planets: []models.DNAPlanet{
				{Key: "a", Name: "A", Meaning: "A", Energy: 80},
			},
		},
	}
}

func TestWorldConfigBuilderSkySection(t *testing.T) {
	builder := NewWorldConfigBuilder()
	config := builder.Build(buildSkyTestInput("cosmic-galaxy", "focused"))

	if config.SchemaVersion != sceneConfigSchemaVersion {
		t.Fatalf("expected schema version %q, got %q", sceneConfigSchemaVersion, config.SchemaVersion)
	}
	if config.Sky == nil {
		t.Fatal("expected a sky section")
	}
	milkyWay := config.Sky.MilkyWay
	if milkyWay.Seed != "WLD-ABC1234567"+milkyWaySeedSuffix {
		t.Fatalf("unexpected milky way seed %q", milkyWay.Seed)
	}
	if config.Sky.Constellations.Seed != "WLD-ABC1234567" {
		t.Fatalf("constellation seed must stay the variant seed, got %q", config.Sky.Constellations.Seed)
	}
	if milkyWay.AllSkyStarCount < minimumAllSkyStarCount || milkyWay.AllSkyStarCount >= minimumAllSkyStarCount+allSkyStarCountSpread {
		t.Fatalf("all-sky star count %d out of bounds", milkyWay.AllSkyStarCount)
	}
	if len(milkyWay.StarColors) == 0 || len(milkyWay.NebulaCloudColors) == 0 || len(milkyWay.DustCloudColors) == 0 {
		t.Fatal("expected weighted color palettes for stars and clouds")
	}
	if milkyWay.NebulaCloudOpacity < minimumNebulaCloudOpacity || milkyWay.NebulaCloudOpacity > maximumNebulaCloudOpacity {
		t.Fatalf("nebula cloud opacity %v out of bounds", milkyWay.NebulaCloudOpacity)
	}
	if milkyWay.RotationRadiansPerSecond <= 0 {
		t.Fatalf("milky way rotation must survive rounding, got %v", milkyWay.RotationRadiansPerSecond)
	}
	displayCount := config.Sky.Constellations.DisplayCount
	if displayCount < minimumConstellationDisplayCount || displayCount >= minimumConstellationDisplayCount+constellationDisplayCountSpread {
		t.Fatalf("constellation display count %d out of bounds", displayCount)
	}
}

func TestWorldConfigBuilderSkyReactsToThemeAndMood(t *testing.T) {
	builder := NewWorldConfigBuilder()

	cosmic := builder.Build(buildSkyTestInput("cosmic-galaxy", "focused"))
	nebulaTheme := builder.Build(buildSkyTestInput("nebula", "focused"))
	if cosmic.Sky.Constellations.LineColor == nebulaTheme.Sky.Constellations.LineColor {
		t.Fatal("expected the world style to recolor the constellation lines")
	}
	if cosmic.Sky.MilkyWay.NebulaCloudColors[3].Color == nebulaTheme.Sky.MilkyWay.NebulaCloudColors[3].Color {
		t.Fatal("expected the world style to swap the nebula accent color")
	}

	dreamy := builder.Build(buildSkyTestInput("cosmic-galaxy", "dreamy"))
	reflective := builder.Build(buildSkyTestInput("cosmic-galaxy", "reflective"))
	if dreamy.Sky.Constellations.GlowMultiplier <= reflective.Sky.Constellations.GlowMultiplier {
		t.Fatalf("expected dreamy glow (%v) > reflective glow (%v)", dreamy.Sky.Constellations.GlowMultiplier, reflective.Sky.Constellations.GlowMultiplier)
	}
	if dreamy.Sky.MilkyWay.BandStarCount <= reflective.Sky.MilkyWay.BandStarCount {
		t.Fatalf("expected dreamy band stars (%d) > reflective (%d)", dreamy.Sky.MilkyWay.BandStarCount, reflective.Sky.MilkyWay.BandStarCount)
	}
	if dreamy.Sky.MilkyWay.RotationRadiansPerSecond >= reflective.Sky.MilkyWay.RotationRadiansPerSecond*3 {
		// dreamy motion 0.7 vs reflective 0.6 — sanity-check the multiplier wiring
		// without over-pinning exact values.
		t.Fatalf("unexpected rotation scaling: dreamy %v vs reflective %v", dreamy.Sky.MilkyWay.RotationRadiansPerSecond, reflective.Sky.MilkyWay.RotationRadiansPerSecond)
	}

	// The sky must not disturb the pre-sky draws: same seed, different runs.
	again := builder.Build(buildSkyTestInput("cosmic-galaxy", "focused"))
	if !reflect.DeepEqual(cosmic, again) {
		t.Fatal("expected the full config including sky to stay deterministic")
	}
}
