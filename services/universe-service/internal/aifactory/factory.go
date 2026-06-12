package aifactory

import (
	"fmt"
	"net/http"
	"time"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/ai/providers"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/config"
)

func NewProvider(name string, cfg config.Config) (ai.Provider, error) {
	client := &http.Client{Timeout: cfg.AITimeout}
	switch ai.ProviderName(name) {
	case ai.ProviderMock:
		return providers.NewMock(), nil
	case ai.ProviderGemini:
		return providers.NewGemini(cfg.GeminiAPIKey, cfg.GeminiModel, client), nil
	case ai.ProviderOpenAI:
		return providers.NewOpenAI(cfg.OpenAIAPIKey, cfg.OpenAIModel, client), nil
	default:
		return nil, fmt.Errorf("unsupported ai provider %q", name)
	}
}

func NewOrchestratorFromConfig(cfg config.Config, validator ai.ResponseValidator) (*ai.Orchestrator, error) {
	primary, err := NewProvider(cfg.AIProvider, cfg)
	if err != nil {
		return nil, err
	}
	var fallback ai.Provider
	if cfg.AIEnableFallback && cfg.AIFallbackProvider != "" && cfg.AIFallbackProvider != cfg.AIProvider {
		fallback, err = NewProvider(cfg.AIFallbackProvider, cfg)
		if err != nil {
			return nil, err
		}
	}
	timeout := cfg.AITimeout
	if timeout <= 0 {
		timeout = 35 * time.Second
	}
	return ai.NewOrchestrator(primary, fallback, validator, timeout).WithRepairAttempts(cfg.AIMaxRetries), nil
}
