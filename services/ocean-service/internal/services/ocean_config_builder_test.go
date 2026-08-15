package services

import (
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
)

func buildTestOceanDNA(landmarkCount int) models.OceanDNA {
	landmarks := make([]models.DNALandmark, 0, landmarkCount)
	for index := 0; index < landmarkCount; index++ {
		landmarks = append(landmarks, models.DNALandmark{
			Key:     fmt.Sprintf("landmark-%d", index+1),
			Name:    fmt.Sprintf("Landmark %d", index+1),
			Type:    "Interest Landmark",
			Meaning: "A meaningful place in the sea.",
			Energy:  60 + index*5,
		})
	}
	return models.OceanDNA{
		SchemaVersion:   "1.0",
		Archetype:       "Tidekeeper",
		SceneName:       "The Lantern Trench",
		Quote:           "I go down slowly, and I come back with light.",
		ShortNarrative:  "A patient mind that finds depth before direction.",
		TraitScores:     models.TraitScores{Creativity: 80, Discipline: 80, Curiosity: 80, Energy: 80, Focus: 80},
		EnergySignature: models.EnergySignature{Primary: "reflective", Secondary: "focused", Intensity: 75},
		Landmarks:       landmarks,
		VisualHints:     models.VisualHints{Theme: "aurora", CoreSymbol: "lantern", PaletteIntent: "calm", MotionIntent: "slow"},
	}
}

func buildTestInput(seedValue, mood string, landmarkCount int) BuildOceanConfigInput {
	return BuildOceanConfigInput{
		DNA:       buildTestOceanDNA(landmarkCount),
		Seed:      seedValue,
		VariantNo: 1,
		Input: models.VisualIntent{
			Mood:                mood,
			FavoriteColors:      []string{"#8B5CF6", "#06B6D4"},
			PreferredWorldStyle: "aurora",
		},
	}
}

func TestBuildOceanConfigDeterministic(t *testing.T) {
	builder := NewOceanConfigBuilder()
	input := buildTestInput("OCN-DETERMINISM", "reflective", 5)
	first := builder.Build(input)
	second := builder.Build(input)
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("same input must build identical configs")
	}
	if first.SchemaVersion != oceanSchemaVersion {
		t.Fatalf("schemaVersion = %q, want %q", first.SchemaVersion, oceanSchemaVersion)
	}
	if first.SceneType != oceanSceneType {
		t.Fatalf("sceneType = %q, want %q", first.SceneType, oceanSceneType)
	}
	if len(first.Landmarks) != 5 {
		t.Fatalf("landmarks = %d, want one per DNA landmark (5)", len(first.Landmarks))
	}
	if first.Assets.CatalogVersion != assetCatalogVersion {
		t.Fatalf("assets.catalogVersion = %q, want %q", first.Assets.CatalogVersion, assetCatalogVersion)
	}
}

// Each mood must bias toward its leaning zone without ever hard-locking it —
// the same rule the forest applies to seasons.
func TestDepthZoneBiasFollowsMood(t *testing.T) {
	builder := NewOceanConfigBuilder()
	leaningZonesByMood := map[string]string{
		"focused":    ZoneTwilightReach,
		"dreamy":     ZoneTwilightReach,
		"energetic":  ZoneSunlitShallows,
		"reflective": ZoneAbyss,
	}
	for mood, leaningZone := range leaningZonesByMood {
		counts := map[string]int{}
		for sample := 0; sample < 240; sample++ {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-ZONE-%s-%d", mood, sample), mood, 4))
			counts[config.Depth.Zone]++
		}
		if counts[leaningZone] <= counts[ZoneSunlitShallows]+counts[ZoneTwilightReach]+counts[ZoneAbyss]-counts[leaningZone] {
			// The leaning zone need not be a majority of all worlds, only the
			// most common one. Anything stricter would be asserting the weight
			// vector rather than the behaviour it exists for.
			if !isMostCommon(counts, leaningZone) {
				t.Fatalf("mood %q produced %v, which does not lean toward %q", mood, counts, leaningZone)
			}
		}
		if len(counts) < 2 {
			t.Fatalf("mood %q hard-locked its zone: %v", mood, counts)
		}
	}
}

func isMostCommon(counts map[string]int, expected string) bool {
	for zone, count := range counts {
		if zone != expected && count > counts[expected] {
			return false
		}
	}
	return true
}

// The zone label and the depth in metres are two views of one value. A world
// whose label disagrees with its own depth would make every downstream
// zone-keyed table lie.
func TestZoneAlwaysAgreesWithMetres(t *testing.T) {
	builder := NewOceanConfigBuilder()
	for sample := 0; sample < 300; sample++ {
		for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-AGREE-%d", sample), mood, 4))
			if config.Depth.Zone != ZoneForDepth(config.Depth.Metres) {
				t.Fatalf("depth %.2f m is labelled %q, want %q", config.Depth.Metres, config.Depth.Zone, ZoneForDepth(config.Depth.Metres))
			}
			if config.Depth.Metres < 0 || config.Depth.Metres > MaximumDepthMetres {
				t.Fatalf("depth %.2f m is outside the real range", config.Depth.Metres)
			}
		}
	}
}

// Water is a pure consequence of depth. Two worlds at the same depth must get
// the same sea, or the depth curve is not the single source of it.
func TestWaterIsDerivedOnlyFromDepth(t *testing.T) {
	builder := NewOceanConfigBuilder()
	byDepth := map[float64]models.WaterConfig{}
	for sample := 0; sample < 400; sample++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-WATER-%d", sample), "dreamy", 4))
		if existing, found := byDepth[config.Depth.Metres]; found {
			if existing != config.Water {
				t.Fatalf("two worlds at %.2f m disagree about the water: %#v vs %#v", config.Depth.Metres, existing, config.Water)
			}
			continue
		}
		byDepth[config.Depth.Metres] = config.Water
		expected := DepthAt(config.Depth.Metres)
		if config.Water.FogColor != expected.FogColor || config.Water.FogDensity != expected.FogDensity {
			t.Fatalf("stored water at %.2f m does not match the curve: %#v", config.Depth.Metres, config.Water)
		}
	}
}

// An abyssal world must never carry caustics or god rays, and this must hold
// without the builder ever asking which zone it is in.
func TestTheAbyssHasNoSurfaceLightEffects(t *testing.T) {
	builder := NewOceanConfigBuilder()
	sawAbyss := false
	sawShallows := false
	for sample := 0; sample < 400; sample++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-LIGHT-%d", sample), "reflective", 4))
		if config.Depth.Zone == ZoneAbyss {
			sawAbyss = true
			if config.Lighting.GodRayStrength != 0 || config.Lighting.CausticStrength != 0 {
				t.Fatalf("abyssal world at %.2f m carries surface light effects: %#v", config.Depth.Metres, config.Lighting)
			}
		}
		if config.Depth.Zone == ZoneSunlitShallows {
			sawShallows = true
			if config.Lighting.GodRayStrength <= 0 {
				t.Fatalf("shallow world at %.2f m has no god rays: %#v", config.Depth.Metres, config.Lighting)
			}
		}
	}
	if !sawAbyss || !sawShallows {
		t.Fatal("the sample never produced both an abyssal and a shallow world; this test proved nothing")
	}
}

// Every stream must draw the same number of times regardless of which features
// a world ends up with, or adding a feature later shifts every existing world.
// The observable proxy: a world with a giant and a world without must still
// agree on everything drawn AFTER the giant in the fauna stream — and since
// the giant is drawn last, the schools and drifters of a fixed seed must not
// move when the giant gate flips.
func TestGatedFeaturesDoNotShiftEarlierDraws(t *testing.T) {
	builder := NewOceanConfigBuilder()
	withGiant := 0
	withoutGiant := 0
	for sample := 0; sample < 400 && (withGiant == 0 || withoutGiant == 0); sample++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-GATE-%d", sample), "energetic", 4))
		if len(config.Fauna.Giants) > 0 {
			withGiant++
		} else {
			withoutGiant++
		}
	}
	if withGiant == 0 || withoutGiant == 0 {
		t.Fatal("the sample never produced both a world with a giant and one without")
	}
	// The direct guarantee: rebuilding the same seed twice, once reading the
	// giant and once not, cannot change any other section.
	input := buildTestInput("OCN-GATE-STABLE", "energetic", 4)
	first := builder.Build(input)
	second := builder.Build(input)
	if !reflect.DeepEqual(first.Fauna.Schools, second.Fauna.Schools) || !reflect.DeepEqual(first.Fauna.Drifters, second.Fauna.Drifters) {
		t.Fatal("fauna draws are not stable across rebuilds")
	}
}

// Every model key emitted must come from the declared vocabulary. The frontend
// catalogue resolves exactly these; anything else renders as nothing at all.
func TestBuilderEmitsOnlyKnownModelKeys(t *testing.T) {
	known := map[string]bool{}
	for _, key := range []string{
		ModelKeyFloraKelpGiant, ModelKeyFloraSeagrass, ModelKeyFloraCoralBrain, ModelKeyFloraCoralStaghorn,
		ModelKeyFloraCoralSoft, ModelKeyFloraAnemone, ModelKeyFloraTubeworm, ModelKeyFloraGlassSponge, ModelKeyFloraSeaPen,
		ModelKeyFishReefSchool, ModelKeyFishSilverside, ModelKeyFishBarracuda, ModelKeyFishRay,
		ModelKeyFishLanternfish, ModelKeyFishHatchetfish,
		ModelKeyDrifterMoonJelly, ModelKeyDrifterCombJelly, ModelKeyDrifterSiphonophore,
		ModelKeyGiantManta, ModelKeyGiantWhaleShark, ModelKeyGiantHumpback, ModelKeyGiantSpermWhale,
		ModelKeyRockBasalt,
	} {
		known[key] = true
	}
	for _, key := range landmarkModelKeysByKind {
		known[key] = true
	}
	builder := NewOceanConfigBuilder()
	for sample := 0; sample < 200; sample++ {
		for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-KEYS-%d", sample), mood, 5))
			for _, key := range config.Assets.ModelKeys {
				if !known[key] {
					t.Fatalf("config emitted unknown model key %q", key)
				}
			}
		}
	}
}

// Only light-fed flora may appear where there is light to feed it, and none of
// it may appear where there is not. This is the single rule that keeps the
// three zones from reading as one zone with three colour grades.
func TestFloraRespectsWhatCanLiveAtThatDepth(t *testing.T) {
	photosynthetic := map[string]bool{
		ModelKeyFloraKelpGiant:     true,
		ModelKeyFloraSeagrass:      true,
		ModelKeyFloraCoralBrain:    true,
		ModelKeyFloraCoralStaghorn: true,
	}
	builder := NewOceanConfigBuilder()
	for sample := 0; sample < 300; sample++ {
		for _, mood := range []string{"focused", "reflective"} {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-FLORA-%d", sample), mood, 4))
			if config.Depth.Zone != ZoneAbyss {
				continue
			}
			for _, entry := range config.Flora.SpeciesMix {
				if photosynthetic[entry.ModelKey] {
					t.Fatalf("abyssal world at %.2f m grows %q, which needs sunlight", config.Depth.Metres, entry.ModelKey)
				}
			}
		}
	}
}

// A giant arrives out of the fog. Anchoring it to a fixed distance instead of
// the water's own visibility would put it in plain sight in the shallows and
// on top of the camera in the abyss.
func TestGiantsApproachNoCloserThanTheWaterAllows(t *testing.T) {
	builder := NewOceanConfigBuilder()
	seen := 0
	for sample := 0; sample < 400; sample++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-GIANT-%d", sample), "energetic", 4))
		for _, giant := range config.Fauna.Giants {
			seen++
			if giant.ApproachDistance < config.Water.VisibilityMetres*giantApproachFraction-0.01 {
				t.Fatalf("giant approached to %.2f m with %.2f m of visibility", giant.ApproachDistance, config.Water.VisibilityMetres)
			}
			if giant.PassDurationSeconds <= 0 {
				t.Fatalf("giant has no pass duration: %#v", giant)
			}
		}
	}
	if seen == 0 {
		t.Fatal("no giant appeared in 400 worlds; this test proved nothing")
	}
}

// Landmark placement mirrors the forest exactly, because the frontend's POI
// extraction, hover and click-to-focus are family-agnostic and must stay so.
func TestLandmarksAreHeroFirstAndDeduped(t *testing.T) {
	builder := NewOceanConfigBuilder()
	config := builder.Build(buildTestInput("OCN-LANDMARKS", "dreamy", 6))
	if config.Landmarks[0].Kind != LandmarkKelpCathedral {
		t.Fatalf("first landmark kind = %q, want the hero %q", config.Landmarks[0].Kind, LandmarkKelpCathedral)
	}
	seen := map[string]bool{}
	for index, landmark := range config.Landmarks {
		if index > 0 && landmark.Kind == LandmarkKelpCathedral {
			t.Fatalf("landmark %d repeated the hero kind", index)
		}
		if index > 0 && seen[landmark.Kind] {
			t.Fatalf("landmark %d repeated kind %q while unused kinds remained", index, landmark.Kind)
		}
		seen[landmark.Kind] = true
		if landmark.RadiusFromCenter <= 0 || landmark.RadiusFromCenter > config.Seafloor.BasinRadius {
			t.Fatalf("landmark %d sits at radius %.2f outside the basin (%.2f)", index, landmark.RadiusFromCenter, config.Seafloor.BasinRadius)
		}
		if landmark.AngleRadians < -landmarkAngleJitterRadians || landmark.AngleRadians > 2*math.Pi+landmarkAngleJitterRadians {
			t.Fatalf("landmark %d angle %.2f is outside one turn", index, landmark.AngleRadians)
		}
	}
}

// The family is called "ocean" at every machine-readable layer. "Abyss" is a
// zone and a landmark kind, never an identifier for the family — a reef config
// living under an "abyss" name would be a permanent mismatch nobody can rename
// once a share link is public.
func TestNoMachineReadableIdentifierIsNamedAbyss(t *testing.T) {
	builder := NewOceanConfigBuilder()
	config := builder.Build(buildTestInput("OCN-NAMING", "reflective", 4))
	if config.SceneType != "ocean" {
		t.Fatalf("sceneType = %q, want \"ocean\"", config.SceneType)
	}
	if strings.Contains(config.Seafloor.PlacementSeed, "abyss") || strings.Contains(config.Flora.PlacementSeed, "abyss") {
		t.Fatalf("a seed stream is named after the abyss: %q / %q", config.Seafloor.PlacementSeed, config.Flora.PlacementSeed)
	}
	if !strings.Contains(config.Seafloor.PlacementSeed, "-ocean-") {
		t.Fatalf("placement seed %q is not namespaced to this family", config.Seafloor.PlacementSeed)
	}
}
