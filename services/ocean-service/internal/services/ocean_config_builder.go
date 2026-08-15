package services

import (
	"fmt"
	"math"

	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/seed"
)

// Renderers are keyed by (sceneType, schemaVersion); any byte-level change to
// what this builder emits for an existing seed is a breaking change and must
// bump the schema version.
const (
	oceanSchemaVersion = "1.0"
	oceanSceneType     = "ocean"
)

// Every section draws from its own seed-derived PRNG stream, in a fixed draw
// order, and ALL draws always happen even when a gate zeroes the feature — so
// adding features later never shifts existing draws (the discipline
// universe-service established and nature-service kept). Labels are prefixed
// "-ocean-" so no stream can ever collide with a forest or universe one.
const (
	depthSeedSuffix           = "-ocean-depth"
	lightingSeedSuffix        = "-ocean-lighting"
	seafloorSeedSuffix        = "-ocean-seafloor"
	currentSeedSuffix         = "-ocean-current"
	floraSeedSuffix           = "-ocean-flora"
	faunaSeedSuffix           = "-ocean-fauna"
	bioluminescenceSeedSuffix = "-ocean-biolum"
	landmarksSeedSuffix       = "-ocean-landmarks"
)

// Frontend-side scatter stream labels. The backend never draws from these; it
// stores them in the config so the renderer derives placements and paths
// deterministically (the MilkyWayConfig.Seed pattern).
const (
	seafloorScatterSeedSuffix    = "-ocean-seafloor-scatter"
	floraPlacementSeedSuffix     = "-ocean-flora-placement"
	bioluminescenceFlickerSuffix = "-ocean-biolum-flicker"
	schoolPathSeedPrefixFormat   = "%s-ocean-school-%d"
	drifterPathSeedPrefixFormat  = "%s-ocean-drifter-%d"
	giantPassSeedPrefixFormat    = "%s-ocean-giant-%d"
)

// Default palette anchors, identical to universe-service and nature-service so
// a visitor's favourite colours read the same across all three portraits.
const (
	defaultPrimaryColor   = "#8B5CF6"
	defaultSecondaryColor = "#06B6D4"
	paletteAccentColor    = "#FACC15"
)

type OceanConfigBuilder struct{}

func NewOceanConfigBuilder() *OceanConfigBuilder {
	return &OceanConfigBuilder{}
}

type BuildOceanConfigInput struct {
	DNA       models.OceanDNA
	Seed      string
	VariantNo int
	Input     models.VisualIntent
}

func (b *OceanConfigBuilder) Build(input BuildOceanConfigInput) models.OceanSceneConfig {
	moodProfile := oceanProfileForMood(input.Input.Mood)
	primary := defaultPrimaryColor
	secondary := defaultSecondaryColor
	if len(input.Input.FavoriteColors) > 0 {
		primary = input.Input.FavoriteColors[0]
	}
	if len(input.Input.FavoriteColors) > 1 {
		secondary = input.Input.FavoriteColors[1]
	}

	depth := buildDepthConfig(input, moodProfile)
	// One evaluation of the curve, reused by every section that needs it. The
	// results are STORED below; nothing recomputes this at render time.
	depthResponse := DepthAt(depth.Metres)

	water := buildWaterConfig(depthResponse)
	lighting, bloomIntensity := buildLightingConfig(input, depthResponse, moodProfile)
	seafloor, cameraDistance := buildSeafloorConfig(input)
	current := buildCurrentConfig(input, depth, moodProfile)
	flora := buildFloraConfig(input, depth, moodProfile)
	fauna := buildFaunaConfig(input, depth, water, moodProfile)
	bioluminescence := buildBioluminescenceConfig(input, depth, moodProfile)
	landmarks := buildLandmarkConfigs(input, seafloor.BasinRadius, primary, secondary)

	return models.OceanSceneConfig{
		SchemaVersion: oceanSchemaVersion,
		SceneType:     oceanSceneType,
		SceneName:     input.DNA.SceneName,
		Archetype:     input.DNA.Archetype,
		Quote:         input.DNA.Quote,
		Theme:         input.DNA.VisualHints.Theme,
		Palette: models.Palette{
			Background: backgroundColorsByZone[depth.Zone],
			Primary:    primary,
			Secondary:  secondary,
			Accent:     paletteAccentColor,
			Gradient:   []string{primary, secondary, paletteAccentColor},
		},
		Depth:           depth,
		Water:           water,
		Lighting:        lighting,
		Seafloor:        seafloor,
		Current:         current,
		Flora:           flora,
		Fauna:           fauna,
		Bioluminescence: bioluminescence,
		Landmarks:       landmarks,
		Camera:          models.CameraConfig{Distance: cameraDistance, FOV: oceanCameraFOV},
		PostFX: models.PostFXConfig{
			BloomIntensity: bloomIntensity,
			// The grade is a per-zone table lookup (no PRNG draw), so two
			// oceans in the same zone always grade identically.
			Grade: oceanGradesByZone[depth.Zone],
		},
		HUD:    models.HUDConfig{ShowTraitBars: true, ShowLabels: true},
		Assets: buildAssetsConfig(flora, fauna, landmarks),
	}
}

// Draw order: zone roll, transition roll, transition direction, blend amount,
// depth-within-band. The transition draws happen even for non-transition
// worlds so the depth pick never shifts.
func buildDepthConfig(input BuildOceanConfigInput, moodProfile oceanMoodProfile) models.DepthConfig {
	rng := seed.NewPRNG(input.Seed + depthSeedSuffix)
	zoneRoll := rng.Float64()
	transitionRoll := rng.Float64()
	transitionDirectionRoll := rng.Float64()
	blendAmountRoll := rng.Float64()
	depthWithinBandRoll := rng.Float64()

	zone := zoneForRoll(zoneRoll, moodProfile.ZoneWeights)
	band := depthBandByZone[zone]
	metres := round(band.Minimum + depthWithinBandRoll*(band.Maximum-band.Minimum))

	config := models.DepthConfig{
		Metres: metres,
		// Derived, never drawn: the zone label and the metres cannot disagree.
		Zone: ZoneForDepth(metres),
	}
	if transitionRoll < zoneTransitionProbability {
		config.BlendTowardZone = adjacentZone(config.Zone, transitionDirectionRoll)
		config.BlendAmount = round(minimumZoneBlendAmount + blendAmountRoll*zoneBlendAmountRange)
	}
	return config
}

// buildWaterConfig draws nothing. Water is entirely a consequence of depth —
// that is the whole point of the family — and giving it a PRNG stream would
// let two worlds at the same depth disagree about the colour of the sea.
func buildWaterConfig(depthResponse DepthResponse) models.WaterConfig {
	return models.WaterConfig{
		FogColor:         depthResponse.FogColor,
		FogDensity:       depthResponse.FogDensity,
		VisibilityMetres: depthResponse.VisibilityMetres,
		TintStrength:     depthResponse.TintStrength,
	}
}

// Draw order: surface elevation, exposure jitter, bloom. Colours, god rays and
// caustics come from the depth curve and are drawn from no stream at all.
// Returns the lighting section plus the bloom intensity (which lives under
// postFX in the envelope).
func buildLightingConfig(input BuildOceanConfigInput, depthResponse DepthResponse, moodProfile oceanMoodProfile) (models.OceanLightingConfig, float64) {
	rng := seed.NewPRNG(input.Seed + lightingSeedSuffix)
	surfaceElevationRoll := rng.Float64()
	exposureRoll := rng.Float64()
	bloomRoll := rng.Float64()

	bloomIntensity := round(clampFloat((baseBloomIntensity+bloomRoll*bloomIntensityRange)*moodProfile.BloomMultiplier, minimumBloomIntensity, maximumBloomIntensity))

	return models.OceanLightingConfig{
		SurfaceLightColor:       depthResponse.SurfaceLightColor,
		SurfaceElevationRadians: round(minimumSurfaceElevation + surfaceElevationRoll*surfaceElevationRange),
		GodRayStrength:          depthResponse.GodRayStrength,
		CausticStrength:         depthResponse.CausticStrength,
		AmbientColor:            depthResponse.AmbientColor,
		Exposure:                round(depthResponse.BaseExposure + exposureRoll*exposureJitterRange),
	}, bloomIntensity
}

// Draw order: basin radius, ridge amplitude, ridge frequency, rock count,
// sediment tuft count, camera distance. Returns the seafloor section plus the
// camera distance (which lives under camera in the envelope).
func buildSeafloorConfig(input BuildOceanConfigInput) (models.SeafloorConfig, float64) {
	rng := seed.NewPRNG(input.Seed + seafloorSeedSuffix)
	basinRoll := rng.Float64()
	ridgeAmplitudeRoll := rng.Float64()
	ridgeFrequencyRoll := rng.Float64()
	rockCount := minimumRockCount + rng.Intn(rockCountSpread)
	sedimentTuftCountDesktop := minimumSedimentTuftCount + rng.Intn(sedimentTuftCountSpread)
	cameraDistanceRoll := rng.Float64()

	config := models.SeafloorConfig{
		PlacementSeed:            input.Seed + seafloorScatterSeedSuffix,
		BasinRadius:              round(minimumBasinRadius + basinRoll*basinRadiusRange),
		RidgeAmplitude:           round(minimumRidgeAmplitude + ridgeAmplitudeRoll*ridgeAmplitudeRange),
		RidgeFrequency:           roundToThousandths(minimumRidgeFrequency + ridgeFrequencyRoll*ridgeFrequencyRange),
		RockCount:                rockCount,
		SedimentTuftCountDesktop: sedimentTuftCountDesktop,
		SedimentTuftCountMobile:  int(float64(sedimentTuftCountDesktop) * mobileSedimentTuftFraction),
	}
	cameraDistance := round(minimumCameraDistance + cameraDistanceRoll*cameraDistanceRange)
	return config, cameraDistance
}

// Draw order: current kind, intensity, direction, gust frequency, marine snow
// count. Marine snow is drawn at every depth — unlike the forest's four
// mutually exclusive seasonal particle systems, there is always something
// falling through seawater.
func buildCurrentConfig(input BuildOceanConfigInput, depth models.DepthConfig, moodProfile oceanMoodProfile) models.CurrentConfig {
	rng := seed.NewPRNG(input.Seed + currentSeedSuffix)
	kindRoll := rng.Float64()
	intensityRoll := rng.Float64()
	directionRoll := rng.Float64()
	gustFrequencyRoll := rng.Float64()
	marineSnowDraw := baseMarineSnowCount + rng.Intn(marineSnowCountSpread)

	kind := currentKindForRoll(kindRoll, currentWeightsByZone[depth.Zone])
	intensity := round(clampFloat((currentIntensityBase+intensityRoll*currentIntensityRange)*moodProfile.CurrentMultiplier, minimumCurrentIntensity, maximumCurrentIntensity))
	return models.CurrentConfig{
		Kind:                   kind,
		Intensity:              intensity,
		DirectionRadians:       round(directionRoll * 2 * math.Pi),
		GustFrequency:          round(gustFrequencyBase + gustFrequencyRoll*gustFrequencyRange),
		MarineSnowCountDesktop: marineSnowDraw,
		MarineSnowCountMobile:  int(float64(marineSnowDraw) * mobileMarineSnowFraction),
	}
}

// Draw order: flora count, species-mix pick, scale minimum, scale maximum,
// sway strength, depth tint.
func buildFloraConfig(input BuildOceanConfigInput, depth models.DepthConfig, moodProfile oceanMoodProfile) models.FloraConfig {
	rng := seed.NewPRNG(input.Seed + floraSeedSuffix)
	floraCountDraw := baseFloraCount + rng.Intn(floraCountSpread)
	speciesMixRoll := rng.Float64()
	scaleMinimumRoll := rng.Float64()
	scaleMaximumRoll := rng.Float64()
	swayStrengthRoll := rng.Float64()
	depthTintRoll := rng.Float64()

	countDesktop := clampInt(floraCountDraw, minimumFloraCount, maximumFloraCount)
	mixes := floraSpeciesMixesByZone[depth.Zone]
	mixIndex := int(speciesMixRoll * float64(len(mixes)))

	return models.FloraConfig{
		PlacementSeed: input.Seed + floraPlacementSeedSuffix,
		CountDesktop:  countDesktop,
		CountMobile:   int(float64(countDesktop) * mobileFloraFraction),
		SpeciesMix:    append([]models.FloraSpeciesMixEntry(nil), mixes[mixIndex]...),
		ScaleMin:      round(floraScaleMinimumBase + scaleMinimumRoll*floraScaleMinimumRange),
		ScaleMax:      round(floraScaleMaximumBase + scaleMaximumRoll*floraScaleMaximumRange),
		// Sway follows the current, so a still abyss has still kelp without
		// anything having to check the zone.
		SwayStrength:      round(clampFloat((swayStrengthBase+swayStrengthRoll*swayStrengthRange)*moodProfile.CurrentMultiplier, minimumSwayStrength, maximumSwayStrength)),
		DepthTintStrength: round(floraDepthTintBaseByZone[depth.Zone] + depthTintRoll*floraDepthTintRange),
	}
}

// schoolSlotDraw / drifterSlotDraw hold one slot's raw draws. Every slot is
// always drawn (fixed PRNG consumption); the zone/mood-scaled active count only
// gates how many drawn slots become config entries.
type schoolSlotDraw struct {
	speciesRoll    float64
	countDraw      int
	speedRoll      float64
	bandBaseRoll   float64
	bandSpanRoll   float64
	cohesionRoll   float64
	separationRoll float64
}

type drifterSlotDraw struct {
	speciesRoll float64
	countDraw   int
	pulseRoll   float64
	colorRoll   float64
}

// Draw order: 3 school slots x (species, count, speed, band base, band span,
// cohesion, separation), then 2 drifter slots x (species, count, pulse,
// colour), then the giant's 4 draws — presence, species, approach, duration —
// which happen whether or not a giant appears.
func buildFaunaConfig(input BuildOceanConfigInput, depth models.DepthConfig, water models.WaterConfig, moodProfile oceanMoodProfile) models.FaunaConfig {
	rng := seed.NewPRNG(input.Seed + faunaSeedSuffix)
	schoolDraws := [maximumSchoolSlots]schoolSlotDraw{}
	for slot := range schoolDraws {
		schoolDraws[slot] = schoolSlotDraw{
			speciesRoll:    rng.Float64(),
			countDraw:      rng.Intn(schoolCountSpread),
			speedRoll:      rng.Float64(),
			bandBaseRoll:   rng.Float64(),
			bandSpanRoll:   rng.Float64(),
			cohesionRoll:   rng.Float64(),
			separationRoll: rng.Float64(),
		}
	}
	drifterDraws := [maximumDrifterSlots]drifterSlotDraw{}
	for slot := range drifterDraws {
		drifterDraws[slot] = drifterSlotDraw{
			speciesRoll: rng.Float64(),
			countDraw:   rng.Intn(drifterCountSpread),
			pulseRoll:   rng.Float64(),
			colorRoll:   rng.Float64(),
		}
	}
	giantPresenceRoll := rng.Float64()
	giantSpeciesRoll := rng.Float64()
	giantApproachRoll := rng.Float64()
	giantDurationRoll := rng.Float64()

	activeSchoolSlots := clampInt(int(math.Round(baseSchoolSlotsByZone[depth.Zone]*moodProfile.FaunaMultiplier)), 0, maximumSchoolSlots)
	activeDrifterSlots := clampInt(int(math.Round(baseDrifterSlotsByZone[depth.Zone]*moodProfile.FaunaMultiplier)), 0, maximumDrifterSlots)

	fishSpecies := fishSpeciesByZone[depth.Zone]
	usedFishSpecies := map[string]bool{}
	schools := make([]models.FishSchoolConfig, 0, activeSchoolSlots)
	for slot := 0; slot < activeSchoolSlots; slot++ {
		draw := schoolDraws[slot]
		speciesIndex := int(draw.speciesRoll * float64(len(fishSpecies)))
		// Deterministic dedupe walk: step forward until an unused species is
		// found; after the list is exhausted repeats are allowed.
		for attempt := 0; attempt < len(fishSpecies) && usedFishSpecies[fishSpecies[speciesIndex]]; attempt++ {
			speciesIndex = (speciesIndex + 1) % len(fishSpecies)
		}
		speciesKey := fishSpecies[speciesIndex]
		usedFishSpecies[speciesKey] = true
		bandMinimum := round(schoolBandBase + draw.bandBaseRoll*schoolBandBaseRange)
		schools = append(schools, models.FishSchoolConfig{
			ModelKey:     speciesKey,
			Count:        schoolCountBase + draw.countDraw,
			PathSeed:     fmt.Sprintf(schoolPathSeedPrefixFormat, input.Seed, slot),
			DepthBandMin: bandMinimum,
			DepthBandMax: round(bandMinimum + schoolBandSpanBase + draw.bandSpanRoll*schoolBandSpanRange),
			SwimSpeed:    round(swimSpeedBase + draw.speedRoll*swimSpeedRange),
			Cohesion:     round(cohesionBase + draw.cohesionRoll*cohesionRange),
			Separation:   round(separationBase + draw.separationRoll*separationRange),
		})
	}

	drifterSpecies := drifterSpeciesByZone[depth.Zone]
	emissiveColors := bioluminescenceColorsByZone[depth.Zone]
	drifters := make([]models.DrifterConfig, 0, activeDrifterSlots)
	for slot := 0; slot < activeDrifterSlots; slot++ {
		draw := drifterDraws[slot]
		speciesIndex := int(draw.speciesRoll * float64(len(drifterSpecies)))
		colorIndex := int(draw.colorRoll * float64(len(emissiveColors)))
		drifters = append(drifters, models.DrifterConfig{
			ModelKey:      drifterSpecies[speciesIndex],
			Count:         drifterCountBase + draw.countDraw,
			PathSeed:      fmt.Sprintf(drifterPathSeedPrefixFormat, input.Seed, slot),
			PulseRate:     round(pulseRateBase + draw.pulseRoll*pulseRateRange),
			EmissiveColor: emissiveColors[colorIndex],
		})
	}

	// At most one giant, and only when the zone's own probability is met.
	giants := make([]models.GiantConfig, 0, 1)
	if giantPresenceRoll < giantProbabilityByZone[depth.Zone] {
		giantSpecies := giantSpeciesByZone[depth.Zone]
		speciesIndex := int(giantSpeciesRoll * float64(len(giantSpecies)))
		giants = append(giants, models.GiantConfig{
			ModelKey: giantSpecies[speciesIndex],
			PassSeed: fmt.Sprintf(giantPassSeedPrefixFormat, input.Seed, 0),
			// Anchored to the water's own visibility rather than to a fixed
			// number, so a giant is always a silhouette at the edge of what can
			// be seen — near the surface that is far away, in the abyss it is
			// uncomfortably close.
			ApproachDistance:    round(water.VisibilityMetres * (giantApproachFraction + giantApproachRoll*giantApproachFractionRange)),
			PassDurationSeconds: round(giantPassDurationBase + giantDurationRoll*giantPassDurationRange),
		})
	}

	return models.FaunaConfig{Schools: schools, Drifters: drifters, Giants: giants}
}

// Draw order: plankton count, bloom intensity. Both are always drawn; the zone
// tables decide how much of it there is.
func buildBioluminescenceConfig(input BuildOceanConfigInput, depth models.DepthConfig, moodProfile oceanMoodProfile) models.BioluminescenceConfig {
	rng := seed.NewPRNG(input.Seed + bioluminescenceSeedSuffix)
	planktonDraw := basePlanktonCountByZone[depth.Zone] + rng.Intn(planktonCountSpreadByZone[depth.Zone])
	bloomRoll := rng.Float64()

	return models.BioluminescenceConfig{
		PlanktonCount: planktonDraw,
		// This brightens light that is already in the scene; it is never what
		// makes it visible. An abyssal world has to read with post-processing
		// switched off.
		BloomIntensity: round(clampFloat((bioluminescenceBloomBase+bloomRoll*bioluminescenceBloomRange)*moodProfile.BloomMultiplier, 0, 1)),
		EmissiveColors: append([]string(nil), bioluminescenceColorsByZone[depth.Zone]...),
		FlickerSeed:    input.Seed + bioluminescenceFlickerSuffix,
	}
}

// Draw order per landmark (DNA order): kind roll, angle jitter, radius, height
// above the floor. The first landmark is always the kelp cathedral; accent
// colours cycle secondary/accent/primary exactly like universe planets and
// forest landmarks, so the palette reads the same across all three portraits.
func buildLandmarkConfigs(input BuildOceanConfigInput, basinRadius float64, primary, secondary string) []models.LandmarkSceneConfig {
	rng := seed.NewPRNG(input.Seed + landmarksSeedSuffix)
	landmarkCount := len(input.DNA.Landmarks)
	landmarks := make([]models.LandmarkSceneConfig, 0, landmarkCount)
	usedKinds := map[string]bool{}
	for index, dnaLandmark := range input.DNA.Landmarks {
		kindRoll := rng.Float64()
		angleJitterRoll := rng.Float64()
		radiusRoll := rng.Float64()
		heightRoll := rng.Float64()

		kind := LandmarkKelpCathedral
		if index > 0 {
			kindIndex := int(kindRoll * float64(len(nonHeroLandmarkKinds)))
			for attempt := 0; attempt < len(nonHeroLandmarkKinds) && usedKinds[nonHeroLandmarkKinds[kindIndex]]; attempt++ {
				kindIndex = (kindIndex + 1) % len(nonHeroLandmarkKinds)
			}
			kind = nonHeroLandmarkKinds[kindIndex]
		}
		usedKinds[kind] = true

		accentColor := secondary
		if index%3 == 1 {
			accentColor = paletteAccentColor
		} else if index%3 == 2 {
			accentColor = primary
		}

		baseAngle := (2 * math.Pi / float64(landmarkCount)) * float64(index)
		landmarks = append(landmarks, models.LandmarkSceneConfig{
			Key:              dnaLandmark.Key,
			Name:             dnaLandmark.Name,
			Meaning:          dnaLandmark.Meaning,
			Kind:             kind,
			AngleRadians:     round(baseAngle + (angleJitterRoll-0.5)*2*landmarkAngleJitterRadians),
			RadiusFromCenter: round(basinRadius * (landmarkRadiusFractionBase + radiusRoll*landmarkRadiusFractionRange)),
			HeightAboveFloor: round(landmarkHeightBase + heightRoll*landmarkHeightRange),
			AccentColor:      accentColor,
			Energy:           dnaLandmark.Energy,
		})
	}
	return landmarks
}

// buildAssetsConfig collects every model key the config references, in a
// deterministic first-use order, so the renderer can prepare them without
// scanning the whole config. There is no hdriKey: this family has no sky.
func buildAssetsConfig(flora models.FloraConfig, fauna models.FaunaConfig, landmarks []models.LandmarkSceneConfig) models.OceanAssetsConfig {
	seenKeys := map[string]bool{}
	modelKeys := make([]string, 0, 16)
	appendKey := func(key string) {
		if key == "" || seenKeys[key] {
			return
		}
		seenKeys[key] = true
		modelKeys = append(modelKeys, key)
	}
	for _, entry := range flora.SpeciesMix {
		appendKey(entry.ModelKey)
	}
	appendKey(ModelKeyRockBasalt)
	for _, school := range fauna.Schools {
		appendKey(school.ModelKey)
	}
	for _, drifter := range fauna.Drifters {
		appendKey(drifter.ModelKey)
	}
	for _, giant := range fauna.Giants {
		appendKey(giant.ModelKey)
	}
	for _, landmark := range landmarks {
		appendKey(landmarkModelKeysByKind[landmark.Kind])
	}
	return models.OceanAssetsConfig{
		CatalogVersion: assetCatalogVersion,
		ModelKeys:      modelKeys,
	}
}

func round(value float64) float64 {
	return math.Round(value*100) / 100
}

// roundToThousandths keeps three decimals for values whose whole dynamic range
// sits below 0.1 (fog density, ridge frequency) — two decimals would quantize
// them into a handful of visible steps.
func roundToThousandths(value float64) float64 {
	return math.Round(value*1000) / 1000
}
