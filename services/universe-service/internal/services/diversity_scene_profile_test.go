package services

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/seed"
)

func buildDiversityTestInput(seedValue string, theme string, mood string) BuildWorldConfigInput {
	return BuildWorldConfigInput{
		Seed:  seedValue,
		Input: models.WorldInput{FavoriteColors: []string{"#8B5CF6", "#06B6D4"}, Mood: mood},
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

func TestWorldConfigBuilderDiversitySectionsDeterministic(t *testing.T) {
	builder := NewWorldConfigBuilder()
	input := buildDiversityTestInput("WLD-ABC1234567", "cosmic-galaxy", "focused")

	first := builder.Build(input)
	second := builder.Build(input)
	if !reflect.DeepEqual(first, second) {
		t.Fatal("expected the full config including diversity sections to stay deterministic")
	}
	if first.SchemaVersion != "1.2" {
		t.Fatalf("expected schema version 1.2, got %q", first.SchemaVersion)
	}
	if first.Belt == nil || first.Comets == nil || first.Sun == nil || first.PostFX.Grade == nil {
		t.Fatal("expected belt, comets, sun and postFX grade sections on a 1.2 config")
	}
}

func TestBeltConfigBoundsAndVariety(t *testing.T) {
	builder := NewWorldConfigBuilder()
	rockColorAllowSet := map[string]bool{}
	for _, color := range beltRockColorPalette {
		rockColorAllowSet[color] = true
	}

	enabledSeen := false
	disabledSeen := false
	for seedIndex := 0; seedIndex < 80; seedIndex++ {
		config := builder.Build(buildDiversityTestInput(fmt.Sprintf("WLD-BELT-%d", seedIndex), "cosmic-galaxy", "focused"))
		belt := config.Belt
		if belt == nil {
			t.Fatal("expected a belt section")
		}
		if belt.Enabled {
			enabledSeen = true
		} else {
			disabledSeen = true
		}
		if belt.InstanceCount < minimumBeltInstanceCount || belt.InstanceCount > maximumBeltInstanceCount {
			t.Fatalf("belt instance count %d out of bounds", belt.InstanceCount)
		}
		if belt.GapBeyondLastOrbit < minimumBeltGapBeyondLastOrbit ||
			belt.GapBeyondLastOrbit > minimumBeltGapBeyondLastOrbit+beltGapBeyondLastOrbitSpread {
			t.Fatalf("belt gap %v out of bounds", belt.GapBeyondLastOrbit)
		}
		if !rockColorAllowSet[belt.RockColor] {
			t.Fatalf("belt rock color %q not in the palette", belt.RockColor)
		}
		if belt.TiltXRadians < -maximumBeltTiltMagnitudeRadians || belt.TiltXRadians > maximumBeltTiltMagnitudeRadians {
			t.Fatalf("belt tilt X %v out of bounds", belt.TiltXRadians)
		}
		if belt.TiltZRadians < -maximumBeltTiltMagnitudeRadians || belt.TiltZRadians > maximumBeltTiltMagnitudeRadians {
			t.Fatalf("belt tilt Z %v out of bounds", belt.TiltZRadians)
		}
	}
	if !enabledSeen || !disabledSeen {
		t.Fatalf("expected both enabled and disabled belts across seeds (enabled=%v disabled=%v)", enabledSeen, disabledSeen)
	}
}

func TestBeltConfigScalesWithMood(t *testing.T) {
	// Same seed, different mood profile: the particle multiplier must scale the
	// instance count in the same direction (dreamy 1.25 vs reflective 0.7).
	input := buildDiversityTestInput("WLD-ABC1234567", "cosmic-galaxy", "dreamy")
	dreamy := buildBeltConfig(input, sceneProfileForMood("dreamy"))
	reflective := buildBeltConfig(input, sceneProfileForMood("reflective"))
	if dreamy.InstanceCount <= reflective.InstanceCount {
		t.Fatalf("expected dreamy belt (%d) denser than reflective (%d)", dreamy.InstanceCount, reflective.InstanceCount)
	}
}

func TestCometsConfigBoundsAndDistribution(t *testing.T) {
	builder := NewWorldConfigBuilder()
	countsSeen := map[int]bool{}
	for seedIndex := 0; seedIndex < 200; seedIndex++ {
		config := builder.Build(buildDiversityTestInput(fmt.Sprintf("WLD-COMET-%d", seedIndex), "cosmic-galaxy", "focused"))
		comets := config.Comets
		if comets == nil {
			t.Fatal("expected a comets section")
		}
		if comets.Count < 0 || comets.Count > maximumCometCount {
			t.Fatalf("comet count %d out of bounds", comets.Count)
		}
		if comets.TailLengthMultiplier < minimumCometTailMultiplier ||
			comets.TailLengthMultiplier > minimumCometTailMultiplier+cometTailMultiplierSpread {
			t.Fatalf("comet tail multiplier %v out of bounds", comets.TailLengthMultiplier)
		}
		countsSeen[comets.Count] = true
	}
	for expectedCount := 0; expectedCount <= maximumCometCount; expectedCount++ {
		if !countsSeen[expectedCount] {
			t.Fatalf("expected comet count %d to occur across 200 seeds", expectedCount)
		}
	}
}

func TestSunConfigClassesAndBounds(t *testing.T) {
	builder := NewWorldConfigBuilder()
	classByTint := map[string]sunTemperatureClass{}
	for _, class := range sunTemperatureClasses {
		classByTint[class.SurfaceTintColor] = class
	}

	tintsSeen := map[string]bool{}
	for seedIndex := 0; seedIndex < 200; seedIndex++ {
		config := builder.Build(buildDiversityTestInput(fmt.Sprintf("WLD-SUN-%d", seedIndex), "cosmic-galaxy", "focused"))
		sun := config.Sun
		if sun == nil {
			t.Fatal("expected a sun section")
		}
		class, knownClass := classByTint[sun.SurfaceTintColor]
		if !knownClass {
			t.Fatalf("sun surface tint %q not in the temperature class table", sun.SurfaceTintColor)
		}
		if sun.GlowColor != class.GlowColor || sun.LightColor != class.LightColor {
			t.Fatalf("sun colors %q/%q do not match the %q class", sun.GlowColor, sun.LightColor, sun.SurfaceTintColor)
		}
		if sun.SurfaceHdrMultiplier < minimumSunSurfaceHdrMultiplier ||
			sun.SurfaceHdrMultiplier > minimumSunSurfaceHdrMultiplier+sunSurfaceHdrMultiplierSpread {
			t.Fatalf("sun HDR multiplier %v out of bounds", sun.SurfaceHdrMultiplier)
		}
		tintsSeen[sun.SurfaceTintColor] = true
	}
	if len(tintsSeen) < 2 {
		t.Fatalf("expected at least two temperature classes across 200 seeds, saw %d", len(tintsSeen))
	}
}

func TestPostFXGradeMatchesThemeTable(t *testing.T) {
	builder := NewWorldConfigBuilder()
	for theme, expectedGrade := range postFXGradesByTheme {
		config := builder.Build(buildDiversityTestInput("WLD-ABC1234567", theme, "focused"))
		if config.PostFX.Grade == nil {
			t.Fatalf("expected a grade for theme %q", theme)
		}
		if *config.PostFX.Grade != expectedGrade {
			t.Fatalf("grade for theme %q: got %+v, want %+v", theme, *config.PostFX.Grade, expectedGrade)
		}
	}
	unknownTheme := builder.Build(buildDiversityTestInput("WLD-ABC1234567", "not-a-theme", "focused"))
	if unknownTheme.PostFX.Grade == nil || *unknownTheme.PostFX.Grade != defaultPostFXGrade {
		t.Fatalf("expected the default grade for an unknown theme, got %+v", unknownTheme.PostFX.Grade)
	}
}

func TestDiversitySectionsDoNotShiftPreExistingDraws(t *testing.T) {
	// The diversity sections draw from their own streams; the main stream's
	// first draw (the core shape) must be reproducible from a fresh PRNG on the
	// bare seed — this fails if belt/comets/sun ever consume the main stream.
	builder := NewWorldConfigBuilder()
	seedValue := "WLD-ABC1234567"
	config := builder.Build(buildDiversityTestInput(seedValue, "cosmic-galaxy", "focused"))

	independentRandom := seed.NewPRNG(seedValue)
	shapes := []string{"sphere", "octahedron", "torus", "box"}
	expectedCoreShape := shapes[independentRandom.Intn(len(shapes))]
	if config.Core.Shape != expectedCoreShape {
		t.Fatalf("core shape %q shifted (expected %q) — a diversity section is consuming the main PRNG stream", config.Core.Shape, expectedCoreShape)
	}
}
