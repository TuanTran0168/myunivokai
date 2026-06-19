package providers

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/ai"
)

type MockProvider struct{}

func NewMock() *MockProvider {
	return &MockProvider{}
}

func (p *MockProvider) Name() ai.ProviderName {
	return ai.ProviderMock
}

// GenerateStructured simulates an AI model: it reads the same user prompt a real
// model would receive, picks a Personality DNA preset that fits the requested
// mood, and personalizes the planets from the user's interests/traits. See
// mock_presets.go for the preset library and selection rules.
func (p *MockProvider) GenerateStructured(ctx context.Context, req ai.StructuredRequest) (*ai.StructuredResponse, error) {
	profile := parseMockProfile(req.UserPrompt)
	preset := selectPreset(profile.Mood)
	dna := buildDNAFromPreset(preset, profile)

	payload, err := json.Marshal(dna)
	if err != nil {
		return nil, err
	}
	simulatedUsage := ai.Usage{InputTokens: 320, OutputTokens: 410, TotalTokens: 730}
	return &ai.StructuredResponse{Provider: ai.ProviderMock, Model: "mock-world-dna-v1", JSON: payload, Usage: simulatedUsage}, nil
}

// mockProfile is the subset of the user profile the mock needs, extracted from
// the structured prompt built by prompts.WorldDNAUserPrompt.
type mockProfile struct {
	Nickname            string
	Interests           []string
	Traits              []string
	Mood                string
	PreferredWorldStyle string
}

func parseMockProfile(userPrompt string) mockProfile {
	return mockProfile{
		Nickname:            promptFieldValue(userPrompt, "Nickname:"),
		Interests:           splitPromptList(promptFieldValue(userPrompt, "Interests:")),
		Traits:              splitPromptList(promptFieldValue(userPrompt, "Traits:")),
		Mood:                promptFieldValue(userPrompt, "Mood:"),
		PreferredWorldStyle: promptFieldValue(userPrompt, "Preferred world style:"),
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
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			items = append(items, trimmed)
		}
	}
	return items
}
