package ai

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/myunivokai/myunivokai/apps/api/internal/models"
)

type ResponseValidator func(json.RawMessage) (models.PersonalityDNA, error)

type AttemptLog struct {
	Provider string
	Model    string
	Status   string
	Error    string
	Response json.RawMessage
	Usage    Usage
	Latency  time.Duration
}

type DNAResult struct {
	DNA      models.PersonalityDNA
	Response *StructuredResponse
	Attempts []AttemptLog
}

type Orchestrator struct {
	primary           Provider
	fallback          Provider
	validate          ResponseValidator
	timeout           time.Duration
	maxRepairAttempts int
}

func NewOrchestrator(primary, fallback Provider, validate ResponseValidator, timeout time.Duration) *Orchestrator {
	return &Orchestrator{primary: primary, fallback: fallback, validate: validate, timeout: timeout}
}

// WithRepairAttempts enables schema-repair retries: when a provider returns
// JSON that fails validation, the same provider is asked again with a repair
// prompt (up to maxRepairAttempts times) before falling back. Transport errors
// are never repaired - they go straight to the fallback provider.
func (o *Orchestrator) WithRepairAttempts(maxRepairAttempts int) *Orchestrator {
	if maxRepairAttempts < 0 {
		maxRepairAttempts = 0
	}
	o.maxRepairAttempts = maxRepairAttempts
	return o
}

func (o *Orchestrator) GeneratePersonalityDNA(ctx context.Context, req StructuredRequest) (*DNAResult, error) {
	if o.primary == nil {
		return nil, errors.New("primary provider is required")
	}
	attempts := make([]AttemptLog, 0, 2)
	result, err := o.tryProvider(ctx, o.primary, req, &attempts)
	if err == nil {
		return result, nil
	}
	if o.fallback != nil {
		result, fallbackErr := o.tryProvider(ctx, o.fallback, req, &attempts)
		if fallbackErr == nil {
			return result, nil
		}
		err = fallbackErr
	}
	return &DNAResult{Attempts: attempts}, err
}

func (o *Orchestrator) tryProvider(ctx context.Context, provider Provider, req StructuredRequest, attempts *[]AttemptLog) (*DNAResult, error) {
	result, validationErr, transportErr := o.callProviderOnce(ctx, provider, req, attempts)
	if transportErr != nil {
		return nil, transportErr
	}
	if validationErr == nil {
		return result, nil
	}

	for repairAttempt := 1; repairAttempt <= o.maxRepairAttempts; repairAttempt++ {
		repairRequest := req
		repairRequest.UserPrompt = buildRepairUserPrompt(req, validationErr)
		result, validationErr, transportErr = o.callProviderOnce(ctx, provider, repairRequest, attempts)
		if transportErr != nil {
			return nil, transportErr
		}
		if validationErr == nil {
			return result, nil
		}
	}
	return nil, validationErr
}

// callProviderOnce performs a single provider call and validation, logging the
// attempt. It separates transport errors (provider unreachable - eligible for
// fallback, never repair) from validation errors (bad JSON - eligible for a
// repair retry on the same provider).
func (o *Orchestrator) callProviderOnce(ctx context.Context, provider Provider, req StructuredRequest, attempts *[]AttemptLog) (result *DNAResult, validationErr error, transportErr error) {
	callCtx, cancel := context.WithTimeout(ctx, o.timeout)
	defer cancel()
	start := time.Now()
	resp, err := provider.GenerateStructured(callCtx, req)
	latency := time.Since(start)
	if err != nil {
		*attempts = append(*attempts, AttemptLog{Provider: string(provider.Name()), Status: "failed", Error: err.Error(), Latency: latency})
		return nil, nil, err
	}
	dna, err := o.validate(resp.JSON)
	if err != nil {
		*attempts = append(*attempts, AttemptLog{Provider: string(provider.Name()), Model: resp.Model, Status: "failed", Error: err.Error(), Response: resp.JSON, Usage: resp.Usage, Latency: latency})
		return nil, err, nil
	}
	*attempts = append(*attempts, AttemptLog{Provider: string(provider.Name()), Model: resp.Model, Status: "success", Response: resp.JSON, Usage: resp.Usage, Latency: latency})
	return &DNAResult{DNA: dna, Response: resp, Attempts: *attempts}, nil, nil
}

func buildRepairUserPrompt(originalRequest StructuredRequest, validationErr error) string {
	repairInstruction := originalRequest.RepairPrompt
	if repairInstruction == "" {
		repairInstruction = "Your previous output did not match the required schema. Return a corrected JSON object only."
	}
	return originalRequest.UserPrompt + "\n\n" + repairInstruction + "\nValidation error: " + validationErr.Error()
}
