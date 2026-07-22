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
	minimumFacetName   = 2
	maximumFacetName   = 40
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

type randomIndexGenerator func(int) int

type MockProvider struct {
	randomIndex randomIndexGenerator
}

func NewMock() *MockProvider {
	return newMock(rand.IntN)
}

func newMock(randomIndex randomIndexGenerator) *MockProvider {
	return &MockProvider{randomIndex: randomIndex}
}

func (provider *MockProvider) Name() ai.ProviderName {
	return ai.ProviderMock
}

func (provider *MockProvider) GenerateStructured(_ context.Context, request ai.StructuredRequest) (*ai.StructuredResponse, error) {
	profile := parsePrompt(request.UserPrompt)
	selectedPreset := selectPreset(profile.Mood, provider.randomIndex)
	profileDNA := contracts.ProfileDNA{
		SchemaVersion:   contracts.SchemaVersionV1,
		Archetype:       selectedPreset.Archetype,
		SceneName:       selectedPreset.SceneName,
		Quote:           selectedPreset.Quote,
		ShortNarrative:  selectedPreset.ShortNarrative,
		TraitScores:     selectedPreset.TraitScores,
		EnergySignature: selectedPreset.EnergySignature,
		Facets:          buildFacets(profile, selectedPreset.FacetMeanings, provider.randomIndex),
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

func buildFacets(profile promptProfile, meanings []string, randomIndex randomIndexGenerator) []contracts.ProfileFacet {
	type facetSource struct {
		name string
		kind string
	}
	seenNames := make(map[string]struct{})
	sources := make([]facetSource, 0, maximumFacetCount)
	appendSource := func(name, kind string) {
		trimmedName := strings.TrimSpace(name)
		nameKey := strings.ToLower(trimmedName)
		if len([]rune(trimmedName)) < minimumFacetName || len([]rune(trimmedName)) > maximumFacetName {
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
			Energy:  minimumFacetEnergy + randomIndex(facetEnergyRange),
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
