package providers

import (
	"fmt"
	"math/rand/v2"
	"strings"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

// The mock provider stands in for a real AI model when no provider key is
// configured (AI_PROVIDER=mock, the default — matching universe-service's
// production setup today). To keep generated forests from all feeling
// identical, it draws from a library of Nature DNA presets instead of a single
// hard-coded one. The atmospheric mood selects a preset GROUP, and one preset
// within that group is picked at random, so the chosen mood is reflected while
// repeated generations still vary. The preferred world style drives the
// rendered theme, and the landmarks are named from the user's own
// interests/traits so each forest feels personal.

const (
	interestLandmarkType = "Interest Landmark"
	traitLandmarkType    = "Trait Landmark"

	mockLandmarkMinimumCount = 3
	mockLandmarkMaximumCount = 7
	mockLandmarkMinimumName  = 2
	mockLandmarkMaximumName  = 40

	mockLandmarkMinimumEnergy = 60
	mockLandmarkEnergyRange   = 36 // produces 60..95

	defaultMockTheme = "cosmic-galaxy"
)

// Mirrors validation.allowedThemes (the same style tokens the create form
// sends to universe-service today); an unknown preferred style falls back to
// defaultMockTheme. A nature-specific style list can replace this once the
// frontend family picker exists.
var mockAllowedThemes = map[string]bool{
	"cosmic-galaxy": true,
	"nebula":        true,
	"crystal":       true,
	"aurora":        true,
	"cyber-orbit":   true,
}

var defaultLandmarkNames = []string{"Heartwood", "Stillwater", "Mossstone", "Fernlight"}

type natureDNAPreset struct {
	Archetype        string
	SceneName        string
	Quote            string
	ShortNarrative   string
	TraitScores      models.TraitScores
	EnergySignature  models.EnergySignature
	CoreSymbol       string
	PaletteIntent    string
	MotionIntent     string
	LandmarkMeanings []string
}

// Presets grouped by atmospheric mood (the values the create form sends).
// The mood → season bias lives in the deterministic builder, so these presets
// only carry semantics: who the person is in forest language.
var presetsByMood = map[string][]natureDNAPreset{
	"focused": {
		{
			Archetype:       "Winter Warden",
			SceneName:       "The Pinebound Sanctum",
			Quote:           "Stillness is where my strength gathers.",
			ShortNarrative:  "A steady mind that keeps its path clear through any weather.",
			TraitScores:     models.TraitScores{Creativity: 78, Discipline: 94, Curiosity: 82, Energy: 74, Focus: 96},
			EnergySignature: models.EnergySignature{Primary: "focused", Secondary: "builder", Intensity: 86},
			CoreSymbol:      "evergreen",
			PaletteIntent:   "deep pine frost precise",
			MotionIntent:    "still air, slow drifting snow",
			LandmarkMeanings: []string{
				"Where your attention stands like an evergreen through every season.",
				"The discipline that keeps the trail visible under snow.",
				"A quiet reserve of patience that outlasts the cold.",
				"Where structure becomes shelter.",
				"The clarity you bring to tangled paths.",
				"A stillness others come to steady themselves by.",
			},
		},
		{
			Archetype:       "Quiet Pathfinder",
			SceneName:       "The Frostline Trail",
			Quote:           "One deliberate step, then the next.",
			ShortNarrative:  "A precise wanderer who turns long distances into short daily walks.",
			TraitScores:     models.TraitScores{Creativity: 74, Discipline: 90, Curiosity: 85, Energy: 78, Focus: 92},
			EnergySignature: models.EnergySignature{Primary: "focused", Secondary: "explorer", Intensity: 84},
			CoreSymbol:      "compass",
			PaletteIntent:   "slate blue winter light",
			MotionIntent:    "measured footsteps, calm branches",
			LandmarkMeanings: []string{
				"The waypoint your focus always finds again.",
				"Where planning turns wilderness into a walkable trail.",
				"A crossing you only pass when you are ready.",
				"The habit that quietly compounds into distance.",
				"Where your resolve waits out the storm.",
				"A marker for every hard mile already behind you.",
			},
		},
	},
	"dreamy": {
		{
			Archetype:       "Blossom Dreamer",
			SceneName:       "The Petal Drift Grove",
			Quote:           "I let wonder fall around me like petals.",
			ShortNarrative:  "A soft-eyed dreamer who sees spring hiding inside ordinary days.",
			TraitScores:     models.TraitScores{Creativity: 96, Discipline: 62, Curiosity: 89, Energy: 70, Focus: 66},
			EnergySignature: models.EnergySignature{Primary: "dreamy", Secondary: "creative", Intensity: 74},
			CoreSymbol:      "blossom",
			PaletteIntent:   "petal pink dawn mist",
			MotionIntent:    "slow drifting petals",
			LandmarkMeanings: []string{
				"Where imagination blooms before the rest of the forest wakes.",
				"A soft place your mind returns to when the world gets loud.",
				"The stream where feelings become stories.",
				"A clearing kept open for what could be.",
				"Where wonder turns into something you can hand to others.",
				"The morning light you carry into new beginnings.",
			},
		},
		{
			Archetype:       "Dawn Wanderer",
			SceneName:       "The Morninglight Hollow",
			Quote:           "I walk a little ahead of the sunrise.",
			ShortNarrative:  "An imaginative soul that lives half a season in the future.",
			TraitScores:     models.TraitScores{Creativity: 93, Discipline: 66, Curiosity: 94, Energy: 72, Focus: 70},
			EnergySignature: models.EnergySignature{Primary: "dreamy", Secondary: "explorer", Intensity: 78},
			CoreSymbol:      "halo",
			PaletteIntent:   "indigo rose first light",
			MotionIntent:    "floating gentle motion",
			LandmarkMeanings: []string{
				"A horizon you keep walking toward, one grove at a time.",
				"Where intuition points before the path appears.",
				"The vision of the forest you can already picture grown.",
				"A pool that reflects what you are becoming.",
				"Where possibility feels close enough to touch.",
				"The wonder that makes ordinary walks bigger.",
			},
		},
	},
	"energetic": {
		{
			Archetype:       "Summer Ranger",
			SceneName:       "The Sunlit Canopy",
			Quote:           "The forest moves, and I move with it.",
			ShortNarrative:  "A high-energy explorer who turns every trail into momentum.",
			TraitScores:     models.TraitScores{Creativity: 88, Discipline: 76, Curiosity: 86, Energy: 96, Focus: 80},
			EnergySignature: models.EnergySignature{Primary: "energetic", Secondary: "explorer", Intensity: 94},
			CoreSymbol:      "sunburst",
			PaletteIntent:   "gold green high summer",
			MotionIntent:    "breezy canopy, quick wings",
			LandmarkMeanings: []string{
				"Your drive that clears new trails at full stride.",
				"A ridge your curiosity insists on climbing.",
				"Where energy turns into things that actually grow.",
				"The spark that pulls the whole forest into motion.",
				"A meadow that rewards showing up every day.",
				"Where boldness finds the sunniest opening.",
			},
		},
		{
			Archetype:       "Trail Blazer",
			SceneName:       "The Greenfire Ridge",
			Quote:           "Start walking and the path appears.",
			ShortNarrative:  "A doer whose energy turns hesitation into forward motion.",
			TraitScores:     models.TraitScores{Creativity: 84, Discipline: 80, Curiosity: 87, Energy: 95, Focus: 82},
			EnergySignature: models.EnergySignature{Primary: "energetic", Secondary: "builder", Intensity: 92},
			CoreSymbol:      "flint",
			PaletteIntent:   "amber leaf vivid daylight",
			MotionIntent:    "fast confident strides",
			LandmarkMeanings: []string{
				"The momentum that turns trailheads into summits.",
				"Where restlessness becomes useful motion.",
				"Your appetite for the unexplored side of the hill.",
				"The energy that makes hard climbs feel possible.",
				"A campfire that gathers others into your pace.",
				"Where action beats overthinking, every time.",
			},
		},
	},
	"reflective": {
		{
			Archetype:       "Grove Keeper",
			SceneName:       "The Amberfall Sanctuary",
			Quote:           "I tend what matters and let the rest fall.",
			ShortNarrative:  "A thoughtful caretaker who finds depth in slow seasons.",
			TraitScores:     models.TraitScores{Creativity: 82, Discipline: 84, Curiosity: 90, Energy: 64, Focus: 88},
			EnergySignature: models.EnergySignature{Primary: "reflective", Secondary: "focused", Intensity: 72},
			CoreSymbol:      "amber leaf",
			PaletteIntent:   "amber teal calm depth",
			MotionIntent:    "slow falling leaves",
			LandmarkMeanings: []string{
				"Where thinking deeply becomes its own kind of shelter.",
				"The patience that lets understanding ripen.",
				"A quiet pool that answers questions slowly and honestly.",
				"The calm you carry into noisy clearings.",
				"Where letting go turns into making room.",
				"A stillness others find steadying.",
			},
		},
		{
			Archetype:       "Mist Cartographer",
			SceneName:       "The Quiet Understory",
			Quote:           "I map the quiet places others rush past.",
			ShortNarrative:  "A reflective explorer of meaning, moss, and inner terrain.",
			TraitScores:     models.TraitScores{Creativity: 85, Discipline: 80, Curiosity: 93, Energy: 62, Focus: 86},
			EnergySignature: models.EnergySignature{Primary: "reflective", Secondary: "explorer", Intensity: 70},
			CoreSymbol:      "lantern",
			PaletteIntent:   "slate moss serene mist",
			MotionIntent:    "gentle drifting fog",
			LandmarkMeanings: []string{
				"A map of meaning you keep redrawing by hand.",
				"Where slow attention reveals the smallest life.",
				"The questions you sit with until they open.",
				"A depth that turns seasons into insight.",
				"Where solitude becomes clarity.",
				"The inner lantern you quietly trust in the dark.",
			},
		},
	},
}

// Used when the mood is empty or not one of the grouped moods (for example the
// legacy "futuristic calm" / "curious" values the validator still accepts).
var balancedPresets = []natureDNAPreset{
	presetsByMood["focused"][0],
	presetsByMood["dreamy"][0],
	presetsByMood["energetic"][0],
	presetsByMood["reflective"][0],
}

func presetGroupForMood(mood string) []natureDNAPreset {
	normalizedMood := strings.ToLower(strings.TrimSpace(mood))
	if group, ok := presetsByMood[normalizedMood]; ok && len(group) > 0 {
		return group
	}
	for moodKey, group := range presetsByMood {
		if len(group) > 0 && strings.Contains(normalizedMood, moodKey) {
			return group
		}
	}
	return balancedPresets
}

func selectPreset(mood string) natureDNAPreset {
	group := presetGroupForMood(mood)
	return group[rand.IntN(len(group))]
}

func buildDNAFromPreset(preset natureDNAPreset, profile mockProfile) models.NatureDNA {
	return models.NatureDNA{
		SchemaVersion:   "1.0",
		Archetype:       preset.Archetype,
		SceneName:       preset.SceneName,
		Quote:           preset.Quote,
		ShortNarrative:  preset.ShortNarrative,
		TraitScores:     preset.TraitScores,
		EnergySignature: preset.EnergySignature,
		Landmarks:       buildPresetLandmarks(preset, profile.Interests, profile.Traits),
		VisualHints: models.VisualHints{
			Theme:         themeForStyle(profile.PreferredWorldStyle),
			CoreSymbol:    preset.CoreSymbol,
			PaletteIntent: preset.PaletteIntent,
			MotionIntent:  preset.MotionIntent,
		},
	}
}

// The preferred world style drives the rendered theme so the user's choice has
// a visible effect; an unsupported or missing style falls back to a safe theme.
func themeForStyle(preferredWorldStyle string) string {
	normalizedStyle := strings.ToLower(strings.TrimSpace(preferredWorldStyle))
	if mockAllowedThemes[normalizedStyle] {
		return normalizedStyle
	}
	return defaultMockTheme
}

func buildPresetLandmarks(preset natureDNAPreset, interests, traits []string) []models.DNALandmark {
	landmarkSources := collectLandmarkSources(interests, traits)
	landmarks := make([]models.DNALandmark, 0, len(landmarkSources))
	for landmarkIndex, source := range landmarkSources {
		landmarks = append(landmarks, models.DNALandmark{
			Key:     landmarkKey(source.name, landmarkIndex),
			Name:    source.name,
			Type:    source.landmarkType,
			Meaning: preset.LandmarkMeanings[landmarkIndex%len(preset.LandmarkMeanings)],
			Energy:  mockLandmarkMinimumEnergy + rand.IntN(mockLandmarkEnergyRange),
		})
	}
	return landmarks
}

type landmarkSource struct {
	name         string
	landmarkType string
}

// Names the landmarks from the user's own interests first, then traits, so the
// generated forest reflects what the user actually cares about. The list is
// deduplicated and clamped to the schema's 3-7 landmark range.
func collectLandmarkSources(interests, traits []string) []landmarkSource {
	seenName := map[string]bool{}
	sources := make([]landmarkSource, 0, mockLandmarkMaximumCount)

	appendSource := func(rawName, landmarkType string) {
		name := sanitizeLandmarkName(rawName)
		if name == "" {
			return
		}
		nameKey := strings.ToLower(name)
		if seenName[nameKey] {
			return
		}
		seenName[nameKey] = true
		sources = append(sources, landmarkSource{name: name, landmarkType: landmarkType})
	}

	for _, interest := range interests {
		appendSource(interest, interestLandmarkType)
	}
	for _, trait := range traits {
		appendSource(trait, traitLandmarkType)
	}
	for fallbackIndex := 0; len(sources) < mockLandmarkMinimumCount; fallbackIndex++ {
		appendSource(defaultLandmarkNames[fallbackIndex%len(defaultLandmarkNames)], traitLandmarkType)
	}
	if len(sources) > mockLandmarkMaximumCount {
		sources = sources[:mockLandmarkMaximumCount]
	}
	return sources
}

func sanitizeLandmarkName(rawName string) string {
	name := strings.TrimSpace(rawName)
	runes := []rune(name)
	if len(runes) < mockLandmarkMinimumName {
		return ""
	}
	if len(runes) > mockLandmarkMaximumName {
		name = strings.TrimSpace(string(runes[:mockLandmarkMaximumName]))
	}
	return name
}

func landmarkKey(name string, landmarkIndex int) string {
	var keyBuilder strings.Builder
	for _, character := range strings.ToLower(name) {
		switch {
		case character >= 'a' && character <= 'z', character >= '0' && character <= '9':
			keyBuilder.WriteRune(character)
		case character == ' ' || character == '-' || character == '_':
			if keyBuilder.Len() > 0 && !strings.HasSuffix(keyBuilder.String(), "-") {
				keyBuilder.WriteRune('-')
			}
		}
	}
	key := strings.Trim(keyBuilder.String(), "-")
	if key == "" {
		return fmt.Sprintf("landmark-%d", landmarkIndex+1)
	}
	return key
}
