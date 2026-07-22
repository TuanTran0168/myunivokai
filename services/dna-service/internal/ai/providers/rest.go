package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai"
)

const (
	geminiEndpointFormat = "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent"
	openAIResponsesURL   = "https://api.openai.com/v1/responses"
)

type GeminiProvider struct {
	apiKey string
	model  string
	client *http.Client
}

func NewGemini(apiKey, model string, client *http.Client) *GeminiProvider {
	return &GeminiProvider{apiKey: apiKey, model: model, client: client}
}

func (provider *GeminiProvider) Name() ai.ProviderName { return ai.ProviderGemini }

func (provider *GeminiProvider) GenerateStructured(ctx context.Context, request ai.StructuredRequest) (*ai.StructuredResponse, error) {
	if provider.apiKey == "" || provider.model == "" {
		return nil, errors.New("gemini provider is missing api key or model")
	}
	requestBody := map[string]any{
		"systemInstruction": map[string]any{"parts": []map[string]string{{"text": request.SystemPrompt}}},
		"contents":          []map[string]any{{"role": "user", "parts": []map[string]string{{"text": request.UserPrompt}}}},
		"generationConfig": map[string]any{
			"temperature":      request.Temperature,
			"maxOutputTokens":  request.MaximumTokens,
			"responseMimeType": "application/json",
			"responseSchema":   sanitizeSchemaForGemini(request.Schema),
		},
	}
	rawResponse, err := postJSON(ctx, provider.client, fmt.Sprintf(geminiEndpointFormat, provider.model), requestBody, map[string]string{"x-goog-api-key": provider.apiKey})
	if err != nil {
		return nil, err
	}
	var decodedResponse struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(rawResponse, &decodedResponse); err != nil {
		return nil, err
	}
	if len(decodedResponse.Candidates) == 0 || len(decodedResponse.Candidates[0].Content.Parts) == 0 {
		return nil, errors.New("gemini returned no JSON content")
	}
	return &ai.StructuredResponse{Provider: ai.ProviderGemini, Model: provider.model, JSON: json.RawMessage(decodedResponse.Candidates[0].Content.Parts[0].Text), Raw: rawResponse}, nil
}

type OpenAIProvider struct {
	apiKey string
	model  string
	client *http.Client
}

func NewOpenAI(apiKey, model string, client *http.Client) *OpenAIProvider {
	return &OpenAIProvider{apiKey: apiKey, model: model, client: client}
}

func (provider *OpenAIProvider) Name() ai.ProviderName { return ai.ProviderOpenAI }

func (provider *OpenAIProvider) GenerateStructured(ctx context.Context, request ai.StructuredRequest) (*ai.StructuredResponse, error) {
	if provider.apiKey == "" || provider.model == "" {
		return nil, errors.New("openai provider is missing api key or model")
	}
	requestBody := map[string]any{
		"model":             provider.model,
		"input":             []map[string]string{{"role": "system", "content": request.SystemPrompt}, {"role": "user", "content": request.UserPrompt}},
		"text":              map[string]any{"format": map[string]any{"type": "json_schema", "name": request.SchemaName, "schema": request.Schema, "strict": true}},
		"temperature":       request.Temperature,
		"max_output_tokens": request.MaximumTokens,
	}
	rawResponse, err := postJSON(ctx, provider.client, openAIResponsesURL, requestBody, map[string]string{"Authorization": "Bearer " + provider.apiKey})
	if err != nil {
		return nil, err
	}
	var decodedResponse struct {
		Output []struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
		OutputText string `json:"output_text"`
	}
	if err := json.Unmarshal(rawResponse, &decodedResponse); err != nil {
		return nil, err
	}
	if decodedResponse.OutputText != "" {
		return &ai.StructuredResponse{Provider: ai.ProviderOpenAI, Model: provider.model, JSON: json.RawMessage(decodedResponse.OutputText), Raw: rawResponse}, nil
	}
	for _, output := range decodedResponse.Output {
		for _, content := range output.Content {
			if content.Text != "" {
				return &ai.StructuredResponse{Provider: ai.ProviderOpenAI, Model: provider.model, JSON: json.RawMessage(content.Text), Raw: rawResponse}, nil
			}
		}
	}
	return nil, errors.New("openai returned no JSON content")
}

var geminiSupportedSchemaKeys = map[string]struct{}{
	"type": {}, "format": {}, "description": {}, "nullable": {}, "enum": {}, "required": {}, "minimum": {}, "maximum": {}, "minItems": {}, "maxItems": {},
}

func sanitizeSchemaForGemini(schema map[string]any) map[string]any {
	sanitizedSchema := make(map[string]any, len(schema))
	for schemaKey, schemaValue := range schema {
		switch schemaKey {
		case "properties":
			if properties, validProperties := schemaValue.(map[string]any); validProperties {
				sanitizedProperties := make(map[string]any, len(properties))
				for propertyName, propertySchema := range properties {
					if propertyMap, validPropertyMap := propertySchema.(map[string]any); validPropertyMap {
						sanitizedProperties[propertyName] = sanitizeSchemaForGemini(propertyMap)
					}
				}
				sanitizedSchema[schemaKey] = sanitizedProperties
			}
		case "items":
			if itemsSchema, validItemsSchema := schemaValue.(map[string]any); validItemsSchema {
				sanitizedSchema[schemaKey] = sanitizeSchemaForGemini(itemsSchema)
			}
		default:
			if _, supported := geminiSupportedSchemaKeys[schemaKey]; supported {
				sanitizedSchema[schemaKey] = schemaValue
			}
		}
	}
	return sanitizedSchema
}

func postJSON(ctx context.Context, client *http.Client, requestURL string, body any, headers map[string]string) ([]byte, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	for headerName, headerValue := range headers {
		request.Header.Set(headerName, headerValue)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	rawResponse, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("provider returned status %d", response.StatusCode)
	}
	return rawResponse, nil
}
