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
	primary  Provider
	fallback Provider
	validate ResponseValidator
	timeout  time.Duration
}

func NewOrchestrator(primary, fallback Provider, validate ResponseValidator, timeout time.Duration) *Orchestrator {
	return &Orchestrator{primary: primary, fallback: fallback, validate: validate, timeout: timeout}
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
	ctx, cancel := context.WithTimeout(ctx, o.timeout)
	defer cancel()
	start := time.Now()
	resp, err := provider.GenerateStructured(ctx, req)
	latency := time.Since(start)
	if err != nil {
		*attempts = append(*attempts, AttemptLog{Provider: string(provider.Name()), Status: "failed", Error: err.Error(), Latency: latency})
		return nil, err
	}
	dna, err := o.validate(resp.JSON)
	if err != nil {
		*attempts = append(*attempts, AttemptLog{Provider: string(provider.Name()), Model: resp.Model, Status: "failed", Error: err.Error(), Response: resp.JSON, Usage: resp.Usage, Latency: latency})
		return nil, err
	}
	*attempts = append(*attempts, AttemptLog{Provider: string(provider.Name()), Model: resp.Model, Status: "success", Response: resp.JSON, Usage: resp.Usage, Latency: latency})
	return &DNAResult{DNA: dna, Response: resp, Attempts: *attempts}, nil
}
