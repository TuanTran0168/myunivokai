package aifactory

import (
	"fmt"
	"time"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/ai/providers"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/config"
)

func NewProvider(name string, cfg config.Config) (ai.Provider, error) {
	switch ai.ProviderName(name) {
	case ai.ProviderMock:
		return providers.NewMock(), nil
	case ai.ProviderGemini, ai.ProviderOpenAI:
		// The REST providers are a mechanical port from universe-service
		// (identical Provider/Orchestrator interfaces), planned for the
		// real-AI round. Until then the service runs on the mock, exactly
		// like universe-service's production deploy today.
		return nil, fmt.Errorf("ai provider %q is not wired into nature-service yet; use mock", name)
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
	return ai.NewOrchestrator(primary, fallback, validator, timeout).
		WithRepairAttempts(cfg.AIMaxRetries).
		WithTotalBudget(cfg.AITotalBudget), nil
}
