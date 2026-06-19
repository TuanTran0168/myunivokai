package providers

import (
	"fmt"
	"math/rand/v2"
	"strings"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
)

// The mock provider stands in for a real AI model when no provider key is
// configured (AI_PROVIDER=mock, the default). To keep generated universes from
// all looking identical, it draws from a library of Personality DNA presets
// instead of a single hard-coded one. The atmospheric mood selects a preset
// GROUP, and one preset within that group is picked at random, so the chosen
// mood is reflected while repeated generations still vary. The preferred world
// style drives the rendered theme, and the planets are named from the user's
// own interests/traits so each world feels personal.

const (
	interestPlanetType = "Interest Planet"
	traitPlanetType    = "Trait Planet"

	mockPlanetMinimumCount = 3
	mockPlanetMaximumCount = 7
	mockPlanetMinimumName  = 2
	mockPlanetMaximumName  = 40

	mockPlanetMinimumEnergy = 60
	mockPlanetEnergyRange   = 36 // produces 60..95

	defaultMockTheme = "cosmic-galaxy"
)

// Mirrors validation.allowedThemes; a theme outside this set is rejected by the
// validator, so an unknown preferred style falls back to defaultMockTheme.
var mockAllowedThemes = map[string]bool{
	"cosmic-galaxy": true,
	"nebula":        true,
	"crystal":       true,
	"aurora":        true,
	"cyber-orbit":   true,
}

var defaultPlanetNames = []string{"Core", "Drive", "Spark", "Origin"}

type personalityDNAPreset struct {
	Archetype       string
	SceneName       string
	Quote           string
	ShortNarrative  string
	TraitScores     models.TraitScores
	EnergySignature models.EnergySignature
	CoreSymbol      string
	PaletteIntent   string
	MotionIntent    string
	PlanetMeanings  []string
}

// Presets grouped by atmospheric mood (the values the create form sends).
var presetsByMood = map[string][]personalityDNAPreset{
	"focused": {
		{
			Archetype:       "Builder Explorer",
			SceneName:       "The Cyan Builder Galaxy",
			Quote:           "I build worlds from curious ideas.",
			ShortNarrative:  "A curious builder who turns ideas into useful worlds.",
			TraitScores:     models.TraitScores{Creativity: 90, Discipline: 86, Curiosity: 92, Energy: 80, Focus: 90},
			EnergySignature: models.EnergySignature{Primary: "builder", Secondary: "explorer", Intensity: 86},
			CoreSymbol:      "crystal",
			PaletteIntent:   "purple cyan premium nebula",
			MotionIntent:    "calm orbiting energy",
			PlanetMeanings: []string{
				"A domain where your builder mindset solves real problems.",
				"Where your focus turns scattered ideas into direction.",
				"A frontier your curiosity keeps pushing further.",
				"The discipline that quietly compounds into mastery.",
				"A place ideas become things that work.",
				"Where steady effort becomes momentum.",
			},
		},
		{
			Archetype:       "Focused Strategist",
			SceneName:       "The Meridian Engine",
			Quote:           "Clarity first, then everything moves.",
			ShortNarrative:  "A precise mind that aligns scattered effort into one direction.",
			TraitScores:     models.TraitScores{Creativity: 78, Discipline: 94, Curiosity: 80, Energy: 76, Focus: 96},
			EnergySignature: models.EnergySignature{Primary: "focused", Secondary: "builder", Intensity: 88},
			CoreSymbol:      "compass",
			PaletteIntent:   "deep blue steel precise",
			MotionIntent:    "steady deliberate orbits",
			PlanetMeanings: []string{
				"Where your attention sharpens into real outcomes.",
				"A discipline that turns plans into progress.",
				"The clarity you bring to complex choices.",
				"A reserve of patience that outlasts noise.",
				"Where structure becomes freedom.",
				"The focus others borrow when things get hard.",
			},
		},
	},
	"dreamy": {
		{
			Archetype:       "Dreaming Artist",
			SceneName:       "The Violet Reverie",
			Quote:           "I paint meaning across quiet skies.",
			ShortNarrative:  "A dreamer who turns feeling into color and form.",
			TraitScores:     models.TraitScores{Creativity: 97, Discipline: 62, Curiosity: 88, Energy: 70, Focus: 66},
			EnergySignature: models.EnergySignature{Primary: "dreamy", Secondary: "creative", Intensity: 74},
			CoreSymbol:      "orb",
			PaletteIntent:   "violet magenta soft glow",
			MotionIntent:    "slow drifting",
			PlanetMeanings: []string{
				"Where emotion becomes imagery only you can make.",
				"The rhythm that guides your inner world.",
				"A story you keep weaving to make sense of things.",
				"The quiet center you always return to.",
				"Where wonder turns into something you can share.",
				"A soft place that keeps your imagination alive.",
			},
		},
		{
			Archetype:       "Lucid Visionary",
			SceneName:       "The Soft Horizon",
			Quote:           "I see the shape of what could be.",
			ShortNarrative:  "An imaginative mind that lives a little ahead of the present.",
			TraitScores:     models.TraitScores{Creativity: 95, Discipline: 66, Curiosity: 93, Energy: 72, Focus: 70},
			EnergySignature: models.EnergySignature{Primary: "dreamy", Secondary: "explorer", Intensity: 78},
			CoreSymbol:      "halo",
			PaletteIntent:   "indigo rose dreamlike",
			MotionIntent:    "floating gentle motion",
			PlanetMeanings: []string{
				"A vision of the future you can already picture.",
				"Where intuition points before logic can explain.",
				"The imagination that reframes any problem.",
				"A horizon you keep walking toward.",
				"Where possibility feels close enough to touch.",
				"The wonder that makes ordinary days bigger.",
			},
		},
	},
	"energetic": {
		{
			Archetype:       "Energetic Creator",
			SceneName:       "The Solar Forge",
			Quote:           "I turn momentum into things that matter.",
			ShortNarrative:  "A high-energy maker who ships fast and bright.",
			TraitScores:     models.TraitScores{Creativity: 89, Discipline: 76, Curiosity: 84, Energy: 96, Focus: 80},
			EnergySignature: models.EnergySignature{Primary: "energetic", Secondary: "builder", Intensity: 94},
			CoreSymbol:      "prism",
			PaletteIntent:   "gold amber high energy",
			MotionIntent:    "fast confident orbiting",
			PlanetMeanings: []string{
				"Your drive to ship and create at full speed.",
				"A fascination that pulls you toward the new.",
				"Your sense for shape, clarity, and craft.",
				"The intensity you bring to every goal.",
				"Where energy turns into real output.",
				"A spark that lights up everyone around it.",
			},
		},
		{
			Archetype:       "Momentum Maker",
			SceneName:       "The Kinetic Bloom",
			Quote:           "Start moving and the path appears.",
			ShortNarrative:  "A doer whose energy turns hesitation into progress.",
			TraitScores:     models.TraitScores{Creativity: 84, Discipline: 80, Curiosity: 86, Energy: 95, Focus: 82},
			EnergySignature: models.EnergySignature{Primary: "energetic", Secondary: "creative", Intensity: 92},
			CoreSymbol:      "comet",
			PaletteIntent:   "orange coral vivid",
			MotionIntent:    "rapid lively orbits",
			PlanetMeanings: []string{
				"The momentum that turns starts into finishes.",
				"Where restlessness becomes useful motion.",
				"Your appetite for trying the next thing.",
				"The energy that makes hard things feel possible.",
				"A drive that pulls others into motion too.",
				"Where action beats overthinking.",
			},
		},
	},
	"reflective": {
		{
			Archetype:       "Reflective Sage",
			SceneName:       "The Quiet Aurora",
			Quote:           "I move slowly, but I move with meaning.",
			ShortNarrative:  "A thoughtful mind that finds depth before direction.",
			TraitScores:     models.TraitScores{Creativity: 82, Discipline: 84, Curiosity: 90, Energy: 64, Focus: 88},
			EnergySignature: models.EnergySignature{Primary: "reflective", Secondary: "focused", Intensity: 72},
			CoreSymbol:      "moon",
			PaletteIntent:   "teal green calm depth",
			MotionIntent:    "slow contemplative orbits",
			PlanetMeanings: []string{
				"Where thinking deeply becomes its own strength.",
				"The patience that lets understanding arrive.",
				"A quiet curiosity that asks better questions.",
				"The calm you carry into noisy moments.",
				"Where reflection turns into wisdom.",
				"A stillness others find steadying.",
			},
		},
		{
			Archetype:       "Inner Cartographer",
			SceneName:       "The Still Expanse",
			Quote:           "I map the quiet places others rush past.",
			ShortNarrative:  "A reflective explorer of ideas, meaning, and inner terrain.",
			TraitScores:     models.TraitScores{Creativity: 85, Discipline: 80, Curiosity: 93, Energy: 62, Focus: 86},
			EnergySignature: models.EnergySignature{Primary: "reflective", Secondary: "explorer", Intensity: 70},
			CoreSymbol:      "lantern",
			PaletteIntent:   "slate cyan serene",
			MotionIntent:    "gentle measured orbits",
			PlanetMeanings: []string{
				"A map of meaning you keep redrawing.",
				"Where slow attention reveals what matters.",
				"The questions you sit with until they open.",
				"A depth that turns experience into insight.",
				"Where solitude becomes clarity.",
				"The inner compass you quietly trust.",
			},
		},
	},
}

// Used when the mood is empty or not one of the grouped moods (for example the
// legacy "futuristic calm" / "curious" values the validator still accepts).
var balancedPresets = []personalityDNAPreset{
	presetsByMood["focused"][0],
	presetsByMood["dreamy"][0],
	presetsByMood["energetic"][0],
	presetsByMood["reflective"][0],
}

func presetGroupForMood(mood string) []personalityDNAPreset {
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

func selectPreset(mood string) personalityDNAPreset {
	group := presetGroupForMood(mood)
	return group[rand.IntN(len(group))]
}

func buildDNAFromPreset(preset personalityDNAPreset, profile mockProfile) models.PersonalityDNA {
	return models.PersonalityDNA{
		SchemaVersion:   "1.0",
		Archetype:       preset.Archetype,
		SceneName:       preset.SceneName,
		Quote:           preset.Quote,
		ShortNarrative:  preset.ShortNarrative,
		TraitScores:     preset.TraitScores,
		EnergySignature: preset.EnergySignature,
		Planets:         buildPresetPlanets(preset, profile.Interests, profile.Traits),
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

func buildPresetPlanets(preset personalityDNAPreset, interests, traits []string) []models.DNAPlanet {
	planetSources := collectPlanetSources(interests, traits)
	planets := make([]models.DNAPlanet, 0, len(planetSources))
	for planetIndex, source := range planetSources {
		planets = append(planets, models.DNAPlanet{
			Key:     planetKey(source.name, planetIndex),
			Name:    source.name,
			Type:    source.planetType,
			Meaning: preset.PlanetMeanings[planetIndex%len(preset.PlanetMeanings)],
			Energy:  mockPlanetMinimumEnergy + rand.IntN(mockPlanetEnergyRange),
		})
	}
	return planets
}

type planetSource struct {
	name       string
	planetType string
}

// Names the planets from the user's own interests first, then traits, so the
// generated world reflects what the user actually cares about. The list is
// deduplicated and clamped to the schema's 3-7 planet range.
func collectPlanetSources(interests, traits []string) []planetSource {
	seenName := map[string]bool{}
	sources := make([]planetSource, 0, mockPlanetMaximumCount)

	appendSource := func(rawName, planetType string) {
		name := sanitizePlanetName(rawName)
		if name == "" {
			return
		}
		nameKey := strings.ToLower(name)
		if seenName[nameKey] {
			return
		}
		seenName[nameKey] = true
		sources = append(sources, planetSource{name: name, planetType: planetType})
	}

	for _, interest := range interests {
		appendSource(interest, interestPlanetType)
	}
	for _, trait := range traits {
		appendSource(trait, traitPlanetType)
	}
	for fallbackIndex := 0; len(sources) < mockPlanetMinimumCount; fallbackIndex++ {
		appendSource(defaultPlanetNames[fallbackIndex%len(defaultPlanetNames)], traitPlanetType)
	}
	if len(sources) > mockPlanetMaximumCount {
		sources = sources[:mockPlanetMaximumCount]
	}
	return sources
}

func sanitizePlanetName(rawName string) string {
	name := strings.TrimSpace(rawName)
	runes := []rune(name)
	if len(runes) < mockPlanetMinimumName {
		return ""
	}
	if len(runes) > mockPlanetMaximumName {
		name = strings.TrimSpace(string(runes[:mockPlanetMaximumName]))
	}
	return name
}

func planetKey(name string, planetIndex int) string {
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
		return fmt.Sprintf("planet-%d", planetIndex+1)
	}
	return key
}
