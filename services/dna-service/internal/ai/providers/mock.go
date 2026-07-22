package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"strings"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai"
)

const (
	minimumFacetCount  = 3
	maximumFacetCount  = 7
	minimumFacetEnergy = 60
	facetEnergyRange   = 36
	defaultTheme       = "cosmic-galaxy"
	mockModelName      = "mock-profile-dna-v1"
)

var allowedThemes = map[string]struct{}{
	"cosmic-galaxy": {},
	"nebula":        {},
	"crystal":       {},
	"aurora":        {},
	"cyber-orbit":   {},
}

var fallbackFacetNames = []string{"Core", "Drive", "Spark", "Origin"}

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

var presetsByMood = map[string]preset{
	"focused": {
		Archetype:       "Builder Explorer",
		SceneName:       "The Cyan Builder",
		Quote:           "I build worlds from curious ideas.",
		ShortNarrative:  "A curious builder who turns ideas into useful worlds.",
		TraitScores:     contracts.TraitScores{Creativity: 90, Discipline: 86, Curiosity: 92, Energy: 80, Focus: 90},
		EnergySignature: contracts.EnergySignature{Primary: "builder", Secondary: "explorer", Intensity: 86},
		CoreSymbol:      "crystal",
		PaletteIntent:   "purple cyan premium",
		MotionIntent:    "calm deliberate energy",
		FacetMeanings:   []string{"A place where your builder mindset solves real problems.", "Where your focus turns scattered ideas into direction.", "A frontier your curiosity keeps pushing further.", "The discipline that quietly compounds into mastery."},
	},
	"dreamy": {
		Archetype:       "Dreaming Artist",
		SceneName:       "The Violet Reverie",
		Quote:           "I paint meaning across quiet skies.",
		ShortNarrative:  "A dreamer who turns feeling into color and form.",
		TraitScores:     contracts.TraitScores{Creativity: 97, Discipline: 62, Curiosity: 88, Energy: 70, Focus: 66},
		EnergySignature: contracts.EnergySignature{Primary: "dreamy", Secondary: "creative", Intensity: 74},
		CoreSymbol:      "orb",
		PaletteIntent:   "violet magenta soft glow",
		MotionIntent:    "slow drifting",
		FacetMeanings:   []string{"Where emotion becomes imagery only you can make.", "The rhythm that guides your inner world.", "A story you keep weaving to make sense of things.", "The quiet center you always return to."},
	},
	"energetic": {
		Archetype:       "Energetic Creator",
		SceneName:       "The Solar Forge",
		Quote:           "I turn momentum into things that matter.",
		ShortNarrative:  "A high-energy maker who ships fast and bright.",
		TraitScores:     contracts.TraitScores{Creativity: 89, Discipline: 76, Curiosity: 84, Energy: 96, Focus: 80},
		EnergySignature: contracts.EnergySignature{Primary: "energetic", Secondary: "builder", Intensity: 94},
		CoreSymbol:      "prism",
		PaletteIntent:   "gold amber high energy",
		MotionIntent:    "fast confident motion",
		FacetMeanings:   []string{"Your drive to ship and create at full speed.", "A fascination that pulls you toward the new.", "Your sense for shape, clarity, and craft.", "The intensity you bring to every goal."},
	},
	"reflective": {
		Archetype:       "Reflective Sage",
		SceneName:       "The Quiet Aurora",
		Quote:           "I move slowly, but I move with meaning.",
		ShortNarrative:  "A thoughtful mind that finds depth before direction.",
		TraitScores:     contracts.TraitScores{Creativity: 82, Discipline: 84, Curiosity: 90, Energy: 64, Focus: 88},
		EnergySignature: contracts.EnergySignature{Primary: "reflective", Secondary: "focused", Intensity: 72},
		CoreSymbol:      "moon",
		PaletteIntent:   "teal green calm depth",
		MotionIntent:    "slow contemplative motion",
		FacetMeanings:   []string{"Where thinking deeply becomes its own strength.", "The patience that lets understanding arrive.", "A quiet curiosity that asks better questions.", "The calm you carry into noisy moments."},
	},
}

type MockProvider struct{}

func NewMock() *MockProvider {
	return &MockProvider{}
}

func (provider *MockProvider) Name() ai.ProviderName {
	return ai.ProviderMock
}

func (provider *MockProvider) GenerateStructured(_ context.Context, request ai.StructuredRequest) (*ai.StructuredResponse, error) {
	profile := parsePrompt(request.UserPrompt)
	selectedPreset, found := presetsByMood[profile.Mood]
	if !found {
		selectedPreset = presetsByMood["focused"]
	}
	profileDNA := contracts.ProfileDNA{
		SchemaVersion:   contracts.SchemaVersionV1,
		Archetype:       selectedPreset.Archetype,
		SceneName:       selectedPreset.SceneName,
		Quote:           selectedPreset.Quote,
		ShortNarrative:  selectedPreset.ShortNarrative,
		TraitScores:     selectedPreset.TraitScores,
		EnergySignature: selectedPreset.EnergySignature,
		Facets:          buildFacets(profile, selectedPreset.FacetMeanings),
		VisualHints: contracts.VisualHints{
			Theme:         supportedTheme(profile.PreferredWorldStyle),
			CoreSymbol:    selectedPreset.CoreSymbol,
			PaletteIntent: selectedPreset.PaletteIntent,
			MotionIntent:  selectedPreset.MotionIntent,
		},
	}
	payload, err := json.Marshal(profileDNA)
	if err != nil {
		return nil, err
	}
	usage := ai.Usage{InputTokens: 320, OutputTokens: 410, TotalTokens: 730}
	return &ai.StructuredResponse{Provider: ai.ProviderMock, Model: mockModelName, JSON: payload, Usage: usage}, nil
}

type promptProfile struct {
	Interests           []string
	Traits              []string
	Mood                string
	PreferredWorldStyle string
}

func parsePrompt(userPrompt string) promptProfile {
	return promptProfile{
		Interests:           splitPromptList(promptFieldValue(userPrompt, "Interests:")),
		Traits:              splitPromptList(promptFieldValue(userPrompt, "Traits:")),
		Mood:                strings.ToLower(promptFieldValue(userPrompt, "Mood:")),
		PreferredWorldStyle: strings.ToLower(promptFieldValue(userPrompt, "Preferred world style:")),
	}
}

func promptFieldValue(userPrompt, label string) string {
	for _, line := range strings.Split(userPrompt, "\n") {
		trimmedLine := strings.TrimSpace(line)
		if strings.HasPrefix(trimmedLine, label) {
			return strings.TrimSpace(strings.TrimPrefix(trimmedLine, label))
		}
	}
	return ""
}

func splitPromptList(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmedPart := strings.TrimSpace(part); trimmedPart != "" {
			items = append(items, trimmedPart)
		}
	}
	return items
}

func buildFacets(profile promptProfile, meanings []string) []contracts.ProfileFacet {
	type facetSource struct {
		name string
		kind string
	}
	seenNames := make(map[string]struct{})
	sources := make([]facetSource, 0, maximumFacetCount)
	appendSource := func(name, kind string) {
		trimmedName := strings.TrimSpace(name)
		nameKey := strings.ToLower(trimmedName)
		if len([]rune(trimmedName)) < 2 || len([]rune(trimmedName)) > 40 {
			return
		}
		if _, found := seenNames[nameKey]; found {
			return
		}
		seenNames[nameKey] = struct{}{}
		sources = append(sources, facetSource{name: trimmedName, kind: kind})
	}
	for _, interest := range profile.Interests {
		appendSource(interest, "interest")
	}
	for _, trait := range profile.Traits {
		appendSource(trait, "trait")
	}
	for fallbackIndex := 0; len(sources) < minimumFacetCount; fallbackIndex++ {
		appendSource(fallbackFacetNames[fallbackIndex%len(fallbackFacetNames)], "trait")
	}
	if len(sources) > maximumFacetCount {
		sources = sources[:maximumFacetCount]
	}
	facets := make([]contracts.ProfileFacet, 0, len(sources))
	for sourceIndex, source := range sources {
		facets = append(facets, contracts.ProfileFacet{
			Key:     facetKey(source.name, sourceIndex),
			Name:    source.name,
			Kind:    source.kind,
			Meaning: meanings[sourceIndex%len(meanings)],
			Energy:  minimumFacetEnergy + rand.IntN(facetEnergyRange),
		})
	}
	return facets
}

func facetKey(name string, facetIndex int) string {
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
		return fmt.Sprintf("facet-%d", facetIndex+1)
	}
	return key
}

func supportedTheme(theme string) string {
	if _, found := allowedThemes[theme]; found {
		return theme
	}
	return defaultTheme
}
