package services

import (
	"strings"

	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
)

// This file is the ocean family's tuning table: every zone/current/fauna table
// and every numeric bound the deterministic builder draws within. It is the
// mirror pair of the frontend's lib/oceanScene.ts — when either changes, the
// other must change with it, the same discipline nature-service keeps with
// lib/forestScene.ts and universe-service with lib/scene.ts.
//
// One thing is deliberately NOT in this file: water colour, fog, ambient
// light, god rays and caustics. Those are computed by depth_curve.go from
// measured physics rather than picked here, which is why this family has no
// per-zone fog-colour table the way the forest has a per-season one.

// Depth zones, in canonical order from the surface down. The order is part of
// the contract: the mood zone-weight vectors index into it, and the
// transitional blend picks an adjacent zone.
//
// NEITHER BOUNDARY IS A ROUND NUMBER SOMEBODY LIKED. Both come out of
// depth_curve.go:
//
//   - The sunlit shallows end where ORANGE does, at 40 m. Above it a scene
//     still has warm colour in it; below it everything warm is already grey.
//   - The twilight reach ends at the SUNLIGHT FLOOR, 1000 m, which is also
//     where god rays and caustics reach zero on their own. That is what makes
//     "the abyss has no caustics" fall out of the physics instead of being a
//     rule somebody has to remember to apply.
const (
	ZoneSunlitShallows = "sunlitShallows"
	ZoneTwilightReach  = "twilightReach"
	ZoneAbyss          = "abyss"
)

var zoneKindsInOrder = []string{ZoneSunlitShallows, ZoneTwilightReach, ZoneAbyss}

const (
	twilightReachTopMetres = orangeDeathMetres
	abyssTopMetres         = SunlightFloorMetres
)

// ZoneForDepth is the single definition of which zone a depth belongs to. The
// builder stores both the metres and the zone; this function is what
// guarantees they can never disagree.
func ZoneForDepth(metres float64) string {
	switch {
	case metres < twilightReachTopMetres:
		return ZoneSunlitShallows
	case metres < abyssTopMetres:
		return ZoneTwilightReach
	default:
		return ZoneAbyss
	}
}

// depthBandByZone is where inside a zone a world is actually placed. The bands
// do not fill their zones edge to edge on purpose: a portrait wants a
// characteristic depth, not a uniform sample. A reef sits where reefs sit.
//
// The bands are chosen so the three zones read as three DIFFERENT WORLDS
// rather than as one world under three colour grades, which is the acceptance
// criterion this family was signed off against:
//
//   - 3-28 m is where reef-building coral actually lives, and where caustics
//     are still legible. A "reef in sunlit water" placed at 50 m is a dark
//     green room.
//   - 45-170 m is the deep blue with faint rays and silhouettes. Placed any
//     deeper it becomes indistinguishable from the abyss — the first draft put
//     it at 220-900 m and a 750 m "twilight" world came out byte-identical in
//     water and lighting to a 2400 m abyssal one.
//   - 1050-3800 m is below the sunlight floor, so every abyssal world is lit
//     by bioluminescence alone as a matter of arithmetic.
var depthBandByZone = map[string]floatRange{
	ZoneSunlitShallows: {Minimum: 3, Maximum: 28},
	ZoneTwilightReach:  {Minimum: 45, Maximum: 170},
	ZoneAbyss:          {Minimum: 1050, Maximum: 3800},
}

// Current kinds. Still water belongs to the deep, surge to the shallows — the
// per-zone weight tables below encode the whole compatibility matrix, the same
// way the forest encodes "snow only in winter".
const (
	CurrentStill = "still"
	CurrentDrift = "drift"
	CurrentSurge = "surge"
)

// Landmark kinds — the ocean counterpart of the forest's landmark kinds. The
// first DNA landmark always becomes the kelp cathedral (the hero of the
// portrait); the rest draw from nonHeroLandmarkKinds with a deterministic
// dedupe walk.
//
// These are also the only place in this service the word "abyssal" appears as
// an identifier, and that is intentional: the abyss is a zone and a landmark,
// never the family. See contracts.WorldFamilyOcean.
const (
	LandmarkKelpCathedral    = "kelpCathedral"
	LandmarkSunkenRelic      = "sunkenRelic"
	LandmarkHydrothermalVent = "hydrothermalVent"
	LandmarkCoralGarden      = "coralGarden"
	LandmarkAbyssalTrench    = "abyssalTrench"
	LandmarkWhaleFall        = "whaleFall"
)

var nonHeroLandmarkKinds = []string{LandmarkSunkenRelic, LandmarkHydrothermalVent, LandmarkCoralGarden, LandmarkAbyssalTrench, LandmarkWhaleFall}

// Model keys the configs may reference.
//
// The ocean-1 catalogue resolves every key below to PROCEDURAL geometry built
// in the browser, not to a downloaded GLB. That is the decision phase O4 of
// notes/vision/ocean-service-plan.md left open, taken this way because no
// agent-downloadable CC0 abyssal creature exists and a species list the
// renderer cannot draw is the one mistake in this family that cannot be undone
// cheaply — species are selected by floor(roll x len), so the order is frozen
// the moment the first world ships.
//
// Swapping a key to a self-hosted GLB later is a purely frontend change: it
// alters no stored config and re-renders every existing world.
const (
	ModelKeyFloraKelpGiant     = "flora-kelp-giant"
	ModelKeyFloraSeagrass      = "flora-seagrass"
	ModelKeyFloraCoralBrain    = "flora-coral-brain"
	ModelKeyFloraCoralStaghorn = "flora-coral-staghorn"
	ModelKeyFloraCoralSoft     = "flora-coral-soft"
	ModelKeyFloraAnemone       = "flora-anemone"
	ModelKeyFloraTubeworm      = "flora-tubeworm"
	ModelKeyFloraGlassSponge   = "flora-glass-sponge"
	ModelKeyFloraSeaPen        = "flora-sea-pen"

	ModelKeyFishReefSchool  = "fish-reef-school"
	ModelKeyFishSilverside  = "fish-silverside"
	ModelKeyFishBarracuda   = "fish-barracuda"
	ModelKeyFishRay         = "fish-ray"
	ModelKeyFishLanternfish = "fish-lanternfish"
	ModelKeyFishHatchetfish = "fish-hatchetfish"

	ModelKeyDrifterMoonJelly    = "drifter-moon-jelly"
	ModelKeyDrifterCombJelly    = "drifter-comb-jelly"
	ModelKeyDrifterSiphonophore = "drifter-siphonophore"

	ModelKeyGiantManta      = "giant-manta"
	ModelKeyGiantWhaleShark = "giant-whale-shark"
	ModelKeyGiantHumpback   = "giant-humpback"
	ModelKeyGiantSpermWhale = "giant-sperm-whale"

	ModelKeyRockBasalt = "rock-basalt"
)

var landmarkModelKeysByKind = map[string]string{
	LandmarkKelpCathedral:    "landmark-kelp-cathedral",
	LandmarkSunkenRelic:      "landmark-sunken-relic",
	LandmarkHydrothermalVent: "landmark-hydrothermal-vent",
	LandmarkCoralGarden:      "landmark-coral-garden",
	LandmarkAbyssalTrench:    "landmark-abyssal-trench",
	LandmarkWhaleFall:        "landmark-whale-fall",
}

// assetCatalogVersion pins which frontend catalogue resolves the model keys, so
// stored configs stay interpretable when the catalogue evolves.
const assetCatalogVersion = "ocean-1"

// oceanMoodProfile tunes the deterministic ocean numbers by atmospheric mood.
// ZoneWeights index into zoneKindsInOrder — a leaning zone, never a hard
// mapping, so repeated generations still vary.
type oceanMoodProfile struct {
	ZoneWeights       [3]float64
	CurrentMultiplier float64
	FaunaMultiplier   float64
	BloomMultiplier   float64
}

var neutralOceanProfile = oceanMoodProfile{
	ZoneWeights:       [3]float64{0.34, 0.33, 0.33},
	CurrentMultiplier: 1.0,
	FaunaMultiplier:   1.0,
	BloomMultiplier:   1.0,
}

// Keyed by the atmospheric mood values the create form sends — the same four
// backend values every family uses. The leaning zone per mood: energetic → the
// reef (surge, most fauna), dreamy and focused → the twilight reach (drifting
// and still respectively), reflective → the abyss (quiet, dark, one light).
//
// Two moods leaning on one zone is deliberate: there are four moods and three
// zones, and inventing a fourth zone to make the table square would add a
// depth band nobody asked for.
var oceanMoodProfiles = map[string]oceanMoodProfile{
	"focused":    {ZoneWeights: [3]float64{0.20, 0.60, 0.20}, CurrentMultiplier: 0.75, FaunaMultiplier: 0.80, BloomMultiplier: 1.00},
	"dreamy":     {ZoneWeights: [3]float64{0.25, 0.60, 0.15}, CurrentMultiplier: 0.85, FaunaMultiplier: 1.00, BloomMultiplier: 1.35},
	"energetic":  {ZoneWeights: [3]float64{0.60, 0.25, 0.15}, CurrentMultiplier: 1.35, FaunaMultiplier: 1.35, BloomMultiplier: 1.15},
	"reflective": {ZoneWeights: [3]float64{0.15, 0.25, 0.60}, CurrentMultiplier: 0.70, FaunaMultiplier: 0.75, BloomMultiplier: 0.85},
}

func oceanProfileForMood(mood string) oceanMoodProfile {
	if profile, ok := oceanMoodProfiles[strings.ToLower(strings.TrimSpace(mood))]; ok {
		return profile
	}
	return neutralOceanProfile
}

type weightedCurrentKind struct {
	Kind   string
	Weight float64
}

// The zone <-> current compatibility matrix, as weights. Weights are relative
// probabilities; they do not need to sum to 1. Surge is a surface phenomenon:
// it is almost absent from the abyss because the energy driving it is.
var currentWeightsByZone = map[string][]weightedCurrentKind{
	ZoneSunlitShallows: {
		{Kind: CurrentStill, Weight: 0.15},
		{Kind: CurrentDrift, Weight: 0.45},
		{Kind: CurrentSurge, Weight: 0.40},
	},
	ZoneTwilightReach: {
		{Kind: CurrentStill, Weight: 0.30},
		{Kind: CurrentDrift, Weight: 0.55},
		{Kind: CurrentSurge, Weight: 0.15},
	},
	ZoneAbyss: {
		{Kind: CurrentStill, Weight: 0.62},
		{Kind: CurrentDrift, Weight: 0.36},
		{Kind: CurrentSurge, Weight: 0.02},
	},
}

// Canvas clear colour behind the water fog — the ocean counterpart of the
// forest's per-season background. Unlike the fog colour, this one IS a table:
// it is the colour of nothing, and nothing has no physics.
var backgroundColorsByZone = map[string]string{
	ZoneSunlitShallows: "#06283A",
	ZoneTwilightReach:  "#041A2B",
	ZoneAbyss:          "#01070F",
}

// Two flora mixes per zone; a seeded roll picks one. The sunlit zone is the
// only one with reef-building corals and the only one where kelp reaches its
// full height, because both need light. The abyss has no photosynthetic life
// at all — tubeworms live on vent chemistry, glass sponges and sea pens
// filter-feed.
var floraSpeciesMixesByZone = map[string][][]models.FloraSpeciesMixEntry{
	ZoneSunlitShallows: {
		{
			{ModelKey: ModelKeyFloraCoralStaghorn, Weight: 0.35},
			{ModelKey: ModelKeyFloraCoralBrain, Weight: 0.25},
			{ModelKey: ModelKeyFloraAnemone, Weight: 0.20},
			{ModelKey: ModelKeyFloraSeagrass, Weight: 0.20},
		},
		{
			{ModelKey: ModelKeyFloraKelpGiant, Weight: 0.40},
			{ModelKey: ModelKeyFloraSeagrass, Weight: 0.30},
			{ModelKey: ModelKeyFloraCoralStaghorn, Weight: 0.30},
		},
	},
	ZoneTwilightReach: {
		{
			{ModelKey: ModelKeyFloraKelpGiant, Weight: 0.45},
			{ModelKey: ModelKeyFloraCoralSoft, Weight: 0.30},
			{ModelKey: ModelKeyFloraAnemone, Weight: 0.25},
		},
		{
			{ModelKey: ModelKeyFloraCoralSoft, Weight: 0.40},
			{ModelKey: ModelKeyFloraSeaPen, Weight: 0.35},
			{ModelKey: ModelKeyFloraAnemone, Weight: 0.25},
		},
	},
	ZoneAbyss: {
		{
			{ModelKey: ModelKeyFloraTubeworm, Weight: 0.45},
			{ModelKey: ModelKeyFloraGlassSponge, Weight: 0.35},
			{ModelKey: ModelKeyFloraSeaPen, Weight: 0.20},
		},
		{
			{ModelKey: ModelKeyFloraGlassSponge, Weight: 0.50},
			{ModelKey: ModelKeyFloraSeaPen, Weight: 0.50},
		},
	},
}

// Reordering or extending any list below shifts the species draw for existing
// seeds, because selection is floor(roll x len). That is a BREAKING change:
// bump oceanSchemaVersion and regenerate the goldens deliberately.
var fishSpeciesByZone = map[string][]string{
	ZoneSunlitShallows: {ModelKeyFishReefSchool, ModelKeyFishSilverside, ModelKeyFishBarracuda, ModelKeyFishRay},
	ZoneTwilightReach:  {ModelKeyFishSilverside, ModelKeyFishLanternfish, ModelKeyFishRay, ModelKeyFishHatchetfish},
	ZoneAbyss:          {ModelKeyFishLanternfish, ModelKeyFishHatchetfish},
}

var drifterSpeciesByZone = map[string][]string{
	ZoneSunlitShallows: {ModelKeyDrifterMoonJelly, ModelKeyDrifterCombJelly},
	ZoneTwilightReach:  {ModelKeyDrifterMoonJelly, ModelKeyDrifterSiphonophore, ModelKeyDrifterCombJelly},
	ZoneAbyss:          {ModelKeyDrifterSiphonophore, ModelKeyDrifterCombJelly},
}

var giantSpeciesByZone = map[string][]string{
	ZoneSunlitShallows: {ModelKeyGiantManta, ModelKeyGiantWhaleShark},
	ZoneTwilightReach:  {ModelKeyGiantHumpback, ModelKeyGiantManta},
	ZoneAbyss:          {ModelKeyGiantSpermWhale},
}

// A giant is a moment, not a fixture. It is rarer the deeper you go, because
// down there it is one animal in a very large volume rather than a herd on a
// reef.
var giantProbabilityByZone = map[string]float64{
	ZoneSunlitShallows: 0.45,
	ZoneTwilightReach:  0.35,
	ZoneAbyss:          0.22,
}

// Base active slot counts before the mood fauna multiplier; fractional so the
// multiplier has room to round up or down. The abyss is emptier of schools and
// fuller of drifters, which is what the deep actually looks like.
var baseSchoolSlotsByZone = map[string]float64{
	ZoneSunlitShallows: 2.8,
	ZoneTwilightReach:  2.0,
	ZoneAbyss:          1.0,
}

var baseDrifterSlotsByZone = map[string]float64{
	ZoneSunlitShallows: 1.0,
	ZoneTwilightReach:  1.8,
	ZoneAbyss:          2.0,
}

// Bioluminescence rises as sunlight falls — not because it is brighter down
// there, but because there is nothing else. Counts are for the plankton haze;
// the drifters carry their own emissive colour separately.
var basePlanktonCountByZone = map[string]int{
	ZoneSunlitShallows: 120,
	ZoneTwilightReach:  520,
	ZoneAbyss:          900,
}

var planktonCountSpreadByZone = map[string]int{
	ZoneSunlitShallows: 121,
	ZoneTwilightReach:  321,
	ZoneAbyss:          501,
}

// Emissive palettes per zone. Shallow bioluminescence is a faint green-white
// that daylight nearly hides; the abyss adds the blue-violet end, which is
// what actually travels furthest in seawater.
var bioluminescenceColorsByZone = map[string][]string{
	ZoneSunlitShallows: {"#8FF3D2", "#B6ECFF"},
	ZoneTwilightReach:  {"#5EEAD4", "#67E8F9", "#A78BFA"},
	ZoneAbyss:          {"#22D3EE", "#818CF8", "#4ADE80"},
}

// Flora keeps more of its own colour than rock does at the same depth, and
// less of it the deeper the zone.
var floraDepthTintBaseByZone = map[string]float64{
	ZoneSunlitShallows: 0.30,
	ZoneTwilightReach:  0.50,
	ZoneAbyss:          0.70,
}

// Per-zone colour grades — the ocean counterpart of the forest's per-season
// grade table. A table lookup, no PRNG draw, so two worlds in the same zone
// always grade identically.
var oceanGradesByZone = map[string]models.PostFXGradeConfig{
	ZoneSunlitShallows: {HueRadians: 0.02, Saturation: 0.14, Brightness: 0.02, Contrast: 0.05},
	ZoneTwilightReach:  {HueRadians: 0.04, Saturation: 0.05, Brightness: 0.03, Contrast: 0.08},
	ZoneAbyss:          {HueRadians: 0.06, Saturation: -0.10, Brightness: 0.06, Contrast: 0.12},
}

type floatRange struct {
	Minimum float64
	Maximum float64
}

// Numeric bounds for every seeded draw. Ranges are expressed as base + range
// so `base + roll*range` reads directly against this table.
const (
	// depth
	zoneTransitionProbability = 0.20
	minimumZoneBlendAmount    = 0.20
	zoneBlendAmountRange      = 0.40

	// lighting. The surface elevation is the angle daylight enters the water
	// at, not the sun's position in a sky this family does not have: it sets
	// the slant of the god rays and the stretch of the caustic pattern.
	minimumSurfaceElevation = 0.55
	surfaceElevationRange   = 0.75
	exposureJitterRange     = 0.10
	baseBloomIntensity      = 0.30
	bloomIntensityRange     = 0.55
	minimumBloomIntensity   = 0.25
	maximumBloomIntensity   = 1.40

	// seafloor
	minimumBasinRadius         = 26.0
	basinRadiusRange           = 12.0
	minimumRidgeAmplitude      = 1.2
	ridgeAmplitudeRange        = 2.6
	minimumRidgeFrequency      = 0.02
	ridgeFrequencyRange        = 0.05
	minimumRockCount           = 10
	rockCountSpread            = 15 // Intn(15) -> 10..24
	minimumSedimentTuftCount   = 400
	sedimentTuftCountSpread    = 501 // 400..900
	mobileSedimentTuftFraction = 0.35
	minimumCameraDistance      = 16.0
	cameraDistanceRange        = 8.0
	oceanCameraFOV             = 55.0

	// current
	currentIntensityBase     = 0.30
	currentIntensityRange    = 0.55
	minimumCurrentIntensity  = 0.05
	maximumCurrentIntensity  = 1.00
	gustFrequencyBase        = 0.18
	gustFrequencyRange       = 0.34
	baseMarineSnowCount      = 900
	marineSnowCountSpread    = 901 // 900..1800
	mobileMarineSnowFraction = 0.30

	// flora
	baseFloraCount         = 90
	floraCountSpread       = 111 // 90..200 before the zone multiplier
	minimumFloraCount      = 40
	maximumFloraCount      = 260
	mobileFloraFraction    = 0.40
	floraScaleMinimumBase  = 0.70
	floraScaleMinimumRange = 0.20
	floraScaleMaximumBase  = 1.25
	floraScaleMaximumRange = 0.45
	swayStrengthBase       = 0.25
	swayStrengthRange      = 0.55
	minimumSwayStrength    = 0.05
	maximumSwayStrength    = 1.00
	floraDepthTintRange    = 0.25

	// fauna — slots are FIXED so the PRNG draw count never changes; the active
	// count only gates how many drawn slots are kept.
	maximumSchoolSlots  = 3
	maximumDrifterSlots = 2
	schoolCountBase     = 9
	schoolCountSpread   = 16 // 9..24 fish per school
	swimSpeedBase       = 0.35
	swimSpeedRange      = 0.55
	cohesionBase        = 0.45
	cohesionRange       = 0.40
	separationBase      = 0.25
	separationRange     = 0.35
	// Depth bands are metres ABOVE the seafloor, not absolute depths: a school
	// keeps its height over the floor as the floor rises and falls.
	schoolBandBase      = 1.5
	schoolBandBaseRange = 9.0
	schoolBandSpanBase  = 2.5
	schoolBandSpanRange = 5.0

	drifterCountBase   = 4
	drifterCountSpread = 9 // 4..12
	pulseRateBase      = 0.25
	pulseRateRange     = 0.45

	// A giant approaches to near the water's visibility limit and no closer,
	// which is what keeps it a silhouette arriving out of the fog.
	giantApproachFraction      = 0.80
	giantApproachFractionRange = 0.35
	giantPassDurationBase      = 22.0
	giantPassDurationRange     = 20.0

	// bioluminescence
	bioluminescenceBloomBase  = 0.20
	bioluminescenceBloomRange = 0.55

	// landmarks
	landmarkAngleJitterRadians  = 0.25
	landmarkRadiusFractionBase  = 0.50
	landmarkRadiusFractionRange = 0.38
	landmarkHeightBase          = 0.0
	landmarkHeightRange         = 6.0
)

// zoneForRoll maps a [0,1) roll onto the mood's zone weights.
func zoneForRoll(roll float64, weights [3]float64) string {
	total := 0.0
	for _, weight := range weights {
		total += weight
	}
	if total <= 0 {
		return zoneKindsInOrder[0]
	}
	cumulative := 0.0
	for index, weight := range weights {
		cumulative += weight
		if roll < cumulative/total {
			return zoneKindsInOrder[index]
		}
	}
	return zoneKindsInOrder[len(zoneKindsInOrder)-1]
}

// adjacentZone picks the zone above or below. Unlike the forest's seasons this
// does NOT wrap: the surface has nothing above it and the abyss nothing below,
// so a roll toward the outside of the stack falls back to the inside
// neighbour rather than teleporting a reef into the trench.
func adjacentZone(kind string, directionRoll float64) string {
	index := 0
	for i, zoneKind := range zoneKindsInOrder {
		if zoneKind == kind {
			index = i
			break
		}
	}
	if directionRoll < 0.5 {
		if index+1 < len(zoneKindsInOrder) {
			return zoneKindsInOrder[index+1]
		}
		return zoneKindsInOrder[index-1]
	}
	if index-1 >= 0 {
		return zoneKindsInOrder[index-1]
	}
	return zoneKindsInOrder[index+1]
}

func currentKindForRoll(roll float64, entries []weightedCurrentKind) string {
	total := 0.0
	for _, entry := range entries {
		total += entry.Weight
	}
	if total <= 0 || len(entries) == 0 {
		return CurrentDrift
	}
	cumulative := 0.0
	for _, entry := range entries {
		cumulative += entry.Weight
		if roll < cumulative/total {
			return entry.Kind
		}
	}
	return entries[len(entries)-1].Kind
}

func clampFloat(value, minimum, maximum float64) float64 {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

func clampInt(value, minimum, maximum int) int {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}
