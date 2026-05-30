package ai

import (
	"context"
	"encoding/json"
)

type ProviderName string

const (
	ProviderGemini ProviderName = "gemini"
	ProviderOpenAI ProviderName = "openai"
	ProviderMock   ProviderName = "mock"
)

type StructuredRequest struct {
	Task          string
	PromptVersion string
	SystemPrompt  string
	UserPrompt    string
	SchemaName    string
	Schema        map[string]any
	Temperature   float32
	MaxTokens     int
}

type Usage struct {
	InputTokens  int `json:"inputTokens,omitempty"`
	OutputTokens int `json:"outputTokens,omitempty"`
	TotalTokens  int `json:"totalTokens,omitempty"`
}

type StructuredResponse struct {
	Provider ProviderName    `json:"provider"`
	Model    string          `json:"model"`
	JSON     json.RawMessage `json:"json"`
	Usage    Usage           `json:"usage"`
	Raw      json.RawMessage `json:"raw,omitempty"`
}

type Provider interface {
	Name() ProviderName
	GenerateStructured(ctx context.Context, req StructuredRequest) (*StructuredResponse, error)
}
