package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/myunivokai/myunivokai/apps/api/internal/ai"
)

type GeminiProvider struct {
	apiKey string
	model  string
	client *http.Client
}

func NewGemini(apiKey, model string, client *http.Client) *GeminiProvider {
	return &GeminiProvider{apiKey: apiKey, model: model, client: client}
}

func (p *GeminiProvider) Name() ai.ProviderName { return ai.ProviderGemini }

func (p *GeminiProvider) GenerateStructured(ctx context.Context, req ai.StructuredRequest) (*ai.StructuredResponse, error) {
	if p.apiKey == "" || p.model == "" {
		return nil, errors.New("gemini provider is missing api key or model")
	}
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", p.model, p.apiKey)
	body := map[string]any{
		"systemInstruction": map[string]any{"parts": []map[string]string{{"text": req.SystemPrompt}}},
		"contents":          []map[string]any{{"role": "user", "parts": []map[string]string{{"text": req.UserPrompt}}}},
		"generationConfig": map[string]any{
			"temperature":      req.Temperature,
			"maxOutputTokens":  req.MaxTokens,
			"responseMimeType": "application/json",
			"responseSchema":   req.Schema,
		},
	}
	raw, err := postJSON(ctx, p.client, url, body, nil)
	if err != nil {
		return nil, err
	}
	var decoded struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	if len(decoded.Candidates) == 0 || len(decoded.Candidates[0].Content.Parts) == 0 {
		return nil, errors.New("gemini returned no JSON content")
	}
	return &ai.StructuredResponse{Provider: ai.ProviderGemini, Model: p.model, JSON: json.RawMessage(decoded.Candidates[0].Content.Parts[0].Text), Raw: raw}, nil
}

type OpenAIProvider struct {
	apiKey string
	model  string
	client *http.Client
}

func NewOpenAI(apiKey, model string, client *http.Client) *OpenAIProvider {
	return &OpenAIProvider{apiKey: apiKey, model: model, client: client}
}

func (p *OpenAIProvider) Name() ai.ProviderName { return ai.ProviderOpenAI }

func (p *OpenAIProvider) GenerateStructured(ctx context.Context, req ai.StructuredRequest) (*ai.StructuredResponse, error) {
	if p.apiKey == "" || p.model == "" {
		return nil, errors.New("openai provider is missing api key or model")
	}
	body := map[string]any{
		"model": p.model,
		"input": []map[string]string{
			{"role": "system", "content": req.SystemPrompt},
			{"role": "user", "content": req.UserPrompt},
		},
		"text": map[string]any{
			"format": map[string]any{
				"type":   "json_schema",
				"name":   req.SchemaName,
				"schema": req.Schema,
				"strict": true,
			},
		},
		"temperature":       req.Temperature,
		"max_output_tokens": req.MaxTokens,
	}
	raw, err := postJSON(ctx, p.client, "https://api.openai.com/v1/responses", body, map[string]string{"Authorization": "Bearer " + p.apiKey})
	if err != nil {
		return nil, err
	}
	var decoded struct {
		Output []struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
		OutputText string `json:"output_text"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	if decoded.OutputText != "" {
		return &ai.StructuredResponse{Provider: ai.ProviderOpenAI, Model: p.model, JSON: json.RawMessage(decoded.OutputText), Raw: raw}, nil
	}
	for _, item := range decoded.Output {
		for _, content := range item.Content {
			if content.Text != "" {
				return &ai.StructuredResponse{Provider: ai.ProviderOpenAI, Model: p.model, JSON: json.RawMessage(content.Text), Raw: raw}, nil
			}
		}
	}
	return nil, errors.New("openai returned no JSON content")
}

func postJSON(ctx context.Context, client *http.Client, url string, body any, headers map[string]string) ([]byte, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("provider returned status %d: %s", resp.StatusCode, string(raw))
	}
	return raw, nil
}
