package aifactory

import (
	"fmt"
	"net/http"

	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai/providers"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/config"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/validation"
)

func NewOrchestrator(serviceConfig config.Config) (*ai.Orchestrator, error) {
	primaryProvider, err := newProvider(serviceConfig.AIProvider, serviceConfig)
	if err != nil {
		return nil, err
	}
	var fallbackProvider ai.Provider
	if serviceConfig.AIEnableFallback && serviceConfig.AIFallbackProvider != "" && serviceConfig.AIFallbackProvider != serviceConfig.AIProvider {
		fallbackProvider, err = newProvider(serviceConfig.AIFallbackProvider, serviceConfig)
		if err != nil {
			return nil, err
		}
	}
	return ai.NewOrchestrator(primaryProvider, fallbackProvider, validation.ValidateProfileDNA, serviceConfig.AITimeout, serviceConfig.AITotalBudget, serviceConfig.AIRepairAttempts), nil
}

func newProvider(providerName string, serviceConfig config.Config) (ai.Provider, error) {
	httpClient := &http.Client{Timeout: serviceConfig.AITimeout}
	switch ai.ProviderName(providerName) {
	case ai.ProviderMock:
		return providers.NewMock(), nil
	case ai.ProviderGemini:
		return providers.NewGemini(serviceConfig.GeminiAPIKey, serviceConfig.GeminiModel, httpClient), nil
	case ai.ProviderOpenAI:
		return providers.NewOpenAI(serviceConfig.OpenAIAPIKey, serviceConfig.OpenAIModel, httpClient), nil
	default:
		return nil, fmt.Errorf("unsupported ai provider %q", providerName)
	}
}
