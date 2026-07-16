package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

// scriptedProvider returns its scripted results in order and records every
// prompt it receives, so tests can assert repair behavior.
type scriptedProvider struct {
	name            ProviderName
	results         []scriptedResult
	callIndex       int
	receivedPrompts []string
}

type scriptedResult struct {
	json string
	err  error
}

func (p *scriptedProvider) Name() ProviderName {
	return p.name
}

func (p *scriptedProvider) GenerateStructured(ctx context.Context, req StructuredRequest) (*StructuredResponse, error) {
	p.receivedPrompts = append(p.receivedPrompts, req.UserPrompt)
	if p.callIndex >= len(p.results) {
		return nil, errors.New("no scripted result left")
	}
	result := p.results[p.callIndex]
	p.callIndex++
	if result.err != nil {
		return nil, result.err
	}
	return &StructuredResponse{Provider: p.name, Model: "scripted", JSON: json.RawMessage(result.json)}, nil
}

func testValidator(raw json.RawMessage) (models.NatureDNA, error) {
	var dna models.NatureDNA
	if err := json.Unmarshal(raw, &dna); err != nil {
		return dna, err
	}
	if dna.Archetype == "" {
		return dna, fmt.Errorf("archetype is required")
	}
	return dna, nil
}

const validScriptedDNA = `{"archetype":"Grove Keeper","sceneName":"The Amberfall Sanctuary"}`

func TestOrchestratorFallsBackOnTransportError(t *testing.T) {
	primary := &scriptedProvider{name: ProviderMock, results: []scriptedResult{{err: errors.New("connection refused")}}}
	fallback := &scriptedProvider{name: ProviderMock, results: []scriptedResult{{json: validScriptedDNA}}}
	orchestrator := NewOrchestrator(primary, fallback, testValidator, time.Second)
	result, err := orchestrator.GenerateNatureDNA(context.Background(), StructuredRequest{UserPrompt: "profile"})
	if err != nil {
		t.Fatalf("fallback should have rescued the request: %v", err)
	}
	if result.DNA.Archetype != "Grove Keeper" {
		t.Fatalf("fallback DNA not used")
	}
	if len(result.Attempts) != 2 || result.Attempts[0].Status != "failed" || result.Attempts[1].Status != "success" {
		t.Fatalf("attempts must record the failed primary and the successful fallback, got %+v", result.Attempts)
	}
}

func TestOrchestratorRepairsValidationFailures(t *testing.T) {
	primary := &scriptedProvider{name: ProviderMock, results: []scriptedResult{
		{json: `{"sceneName":"missing archetype"}`},
		{json: validScriptedDNA},
	}}
	orchestrator := NewOrchestrator(primary, nil, testValidator, time.Second).WithRepairAttempts(1)
	result, err := orchestrator.GenerateNatureDNA(context.Background(), StructuredRequest{UserPrompt: "profile", RepairPrompt: "Fix the JSON."})
	if err != nil {
		t.Fatalf("repair retry should have succeeded: %v", err)
	}
	if result.DNA.Archetype != "Grove Keeper" {
		t.Fatalf("repaired DNA not used")
	}
	if len(primary.receivedPrompts) != 2 {
		t.Fatalf("expected exactly one repair retry, got %d calls", len(primary.receivedPrompts))
	}
	repairPrompt := primary.receivedPrompts[1]
	if !strings.Contains(repairPrompt, "Fix the JSON.") || !strings.Contains(repairPrompt, "Validation error:") {
		t.Fatalf("repair call must carry the repair prompt and the validation error, got %q", repairPrompt)
	}
}

func TestOrchestratorReturnsAttemptsWhenEverythingFails(t *testing.T) {
	primary := &scriptedProvider{name: ProviderMock, results: []scriptedResult{{err: errors.New("connection refused")}}}
	orchestrator := NewOrchestrator(primary, nil, testValidator, time.Second)
	result, err := orchestrator.GenerateNatureDNA(context.Background(), StructuredRequest{UserPrompt: "profile"})
	if err == nil {
		t.Fatalf("expected an error when the only provider fails")
	}
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("transport failures must map to ErrProviderUnavailable, got %v", err)
	}
	if result == nil || len(result.Attempts) != 1 {
		t.Fatalf("failed attempts must still be returned for logging")
	}
}
