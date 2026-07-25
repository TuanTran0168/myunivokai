package providers

import (
	"strings"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// The mock provider models the variability of a real provider without making
// external calls. Mood chooses a relevant group; every generation chooses a
// preset within that group and randomizes facet energy independently.
type preset struct {
	Archetype       string
	SceneName       string
	Quote           string
	ShortNarrative  string
	TraitScores     contracts.TraitScores
	EnergySignature contracts.EnergySignature
	CoreSymbol      string
	PaletteIntent   string
	MotionIntent    string
	FacetMeanings   []string
}

var presetMoodOrder = []string{"focused", "dreamy", "energetic", "reflective"}

var presetsByMood = map[string][]preset{
	"focused": {
		{
			Archetype:       "Builder Explorer",
			SceneName:       "The Cyan Builder",
			Quote:           "I build worlds from curious ideas.",
			ShortNarrative:  "A curious builder who turns ideas into useful worlds.",
			TraitScores:     contracts.TraitScores{Creativity: 90, Discipline: 86, Curiosity: 92, Energy: 80, Focus: 90},
			EnergySignature: contracts.EnergySignature{Primary: "builder", Secondary: "explorer", Intensity: 86},
			CoreSymbol:      "crystal",
			PaletteIntent:   "purple cyan premium",
			MotionIntent:    "calm deliberate energy",
			FacetMeanings: []string{
				"A place where your builder mindset solves real problems.",
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
			TraitScores:     contracts.TraitScores{Creativity: 78, Discipline: 94, Curiosity: 80, Energy: 76, Focus: 96},
			EnergySignature: contracts.EnergySignature{Primary: "focused", Secondary: "builder", Intensity: 88},
			CoreSymbol:      "compass",
			PaletteIntent:   "deep blue steel precise",
			MotionIntent:    "steady deliberate energy",
			FacetMeanings: []string{
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
			TraitScores:     contracts.TraitScores{Creativity: 97, Discipline: 62, Curiosity: 88, Energy: 70, Focus: 66},
			EnergySignature: contracts.EnergySignature{Primary: "dreamy", Secondary: "creative", Intensity: 74},
			CoreSymbol:      "orb",
			PaletteIntent:   "violet magenta soft glow",
			MotionIntent:    "slow drifting",
			FacetMeanings: []string{
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
			TraitScores:     contracts.TraitScores{Creativity: 95, Discipline: 66, Curiosity: 93, Energy: 72, Focus: 70},
			EnergySignature: contracts.EnergySignature{Primary: "dreamy", Secondary: "explorer", Intensity: 78},
			CoreSymbol:      "halo",
			PaletteIntent:   "indigo rose dreamlike",
			MotionIntent:    "floating gentle motion",
			FacetMeanings: []string{
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
			TraitScores:     contracts.TraitScores{Creativity: 89, Discipline: 76, Curiosity: 84, Energy: 96, Focus: 80},
			EnergySignature: contracts.EnergySignature{Primary: "energetic", Secondary: "builder", Intensity: 94},
			CoreSymbol:      "prism",
			PaletteIntent:   "gold amber high energy",
			MotionIntent:    "fast confident motion",
			FacetMeanings: []string{
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
			TraitScores:     contracts.TraitScores{Creativity: 84, Discipline: 80, Curiosity: 86, Energy: 95, Focus: 82},
			EnergySignature: contracts.EnergySignature{Primary: "energetic", Secondary: "creative", Intensity: 92},
			CoreSymbol:      "comet",
			PaletteIntent:   "orange coral vivid",
			MotionIntent:    "rapid lively motion",
			FacetMeanings: []string{
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
			TraitScores:     contracts.TraitScores{Creativity: 82, Discipline: 84, Curiosity: 90, Energy: 64, Focus: 88},
			EnergySignature: contracts.EnergySignature{Primary: "reflective", Secondary: "focused", Intensity: 72},
			CoreSymbol:      "moon",
			PaletteIntent:   "teal green calm depth",
			MotionIntent:    "slow contemplative motion",
			FacetMeanings: []string{
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
			TraitScores:     contracts.TraitScores{Creativity: 85, Discipline: 80, Curiosity: 93, Energy: 62, Focus: 86},
			EnergySignature: contracts.EnergySignature{Primary: "reflective", Secondary: "explorer", Intensity: 70},
			CoreSymbol:      "lantern",
			PaletteIntent:   "slate cyan serene",
			MotionIntent:    "gentle measured motion",
			FacetMeanings: []string{
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

var balancedPresets = []preset{
	presetsByMood["focused"][0],
	presetsByMood["dreamy"][0],
	presetsByMood["energetic"][0],
	presetsByMood["reflective"][0],
}

func selectPreset(mood string, randomIndex randomIndexGenerator) preset {
	group := presetGroupForMood(mood)
	return group[randomIndex(len(group))]
}

func presetGroupForMood(mood string) []preset {
	normalizedMood := strings.ToLower(strings.TrimSpace(mood))
	if group, found := presetsByMood[normalizedMood]; found && len(group) > 0 {
		return group
	}
	for _, moodKey := range presetMoodOrder {
		if strings.Contains(normalizedMood, moodKey) {
			return presetsByMood[moodKey]
		}
	}
	return balancedPresets
}
