package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

var ErrProviderUnavailable = errors.New("ai provider unavailable")

type ResponseValidator func(json.RawMessage) (contracts.ProfileDNA, error)

type Attempt struct {
	Provider      string
	Model         string
	Task          string
	PromptVersion string
	InputHash     string
	Status        string
	Error         string
	Response      json.RawMessage
	Usage         Usage
	Latency       time.Duration
}

type Result struct {
	ProfileDNA contracts.ProfileDNA
	Attempts   []Attempt
}

type Orchestrator struct {
	primaryProvider  Provider
	fallbackProvider Provider
	validator        ResponseValidator
	callTimeout      time.Duration
	totalBudget      time.Duration
	repairAttempts   int
}

func NewOrchestrator(primaryProvider, fallbackProvider Provider, validator ResponseValidator, callTimeout, totalBudget time.Duration, repairAttempts int) *Orchestrator {
	return &Orchestrator{
		primaryProvider:  primaryProvider,
		fallbackProvider: fallbackProvider,
		validator:        validator,
		callTimeout:      callTimeout,
		totalBudget:      totalBudget,
		repairAttempts:   repairAttempts,
	}
}

func (orchestrator *Orchestrator) GenerateProfileDNA(ctx context.Context, request StructuredRequest) (Result, error) {
	if orchestrator.primaryProvider == nil {
		return Result{}, errors.New("primary provider is required")
	}
	budgetContext, cancel := context.WithTimeout(ctx, orchestrator.totalBudget)
	defer cancel()
	attempts := make([]Attempt, 0, 2+orchestrator.repairAttempts)
	result, err := orchestrator.tryProvider(budgetContext, orchestrator.primaryProvider, request, &attempts)
	if err == nil {
		return result, nil
	}
	if orchestrator.fallbackProvider != nil {
		result, fallbackError := orchestrator.tryProvider(budgetContext, orchestrator.fallbackProvider, request, &attempts)
		if fallbackError == nil {
			return result, nil
		}
		err = fallbackError
	}
	return Result{Attempts: attempts}, err
}

func (orchestrator *Orchestrator) tryProvider(ctx context.Context, provider Provider, request StructuredRequest, attempts *[]Attempt) (Result, error) {
	result, validationError, transportError := orchestrator.callProvider(ctx, provider, request, attempts)
	if transportError != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrProviderUnavailable, transportError)
	}
	if validationError == nil {
		return result, nil
	}
	for repairAttempt := 0; repairAttempt < orchestrator.repairAttempts; repairAttempt++ {
		repairRequest := request
		repairRequest.UserPrompt = request.UserPrompt + "\n\n" + request.RepairPrompt + "\nValidation error: " + validationError.Error()
		result, validationError, transportError = orchestrator.callProvider(ctx, provider, repairRequest, attempts)
		if transportError != nil {
			return Result{}, fmt.Errorf("%w: %v", ErrProviderUnavailable, transportError)
		}
		if validationError == nil {
			return result, nil
		}
	}
	return Result{}, validationError
}

func (orchestrator *Orchestrator) callProvider(ctx context.Context, provider Provider, request StructuredRequest, attempts *[]Attempt) (Result, error, error) {
	callContext, cancel := context.WithTimeout(ctx, orchestrator.callTimeout)
	defer cancel()
	startedAt := time.Now()
	response, err := provider.GenerateStructured(callContext, request)
	latency := time.Since(startedAt)
	attempt := Attempt{
		Provider: string(provider.Name()), Task: request.Task, PromptVersion: request.PromptVersion,
		InputHash: fmt.Sprintf("%x", sha256.Sum256([]byte(request.UserPrompt))), Latency: latency,
	}
	if err != nil {
		attempt.Status = "failed"
		attempt.Error = err.Error()
		*attempts = append(*attempts, attempt)
		return Result{}, nil, err
	}
	profileDNA, err := orchestrator.validator(response.JSON)
	attempt.Model = response.Model
	attempt.Response = response.JSON
	attempt.Usage = response.Usage
	if err != nil {
		attempt.Status = "failed"
		attempt.Error = err.Error()
		*attempts = append(*attempts, attempt)
		return Result{}, err, nil
	}
	attempt.Status = "success"
	*attempts = append(*attempts, attempt)
	return Result{ProfileDNA: profileDNA, Attempts: *attempts}, nil, nil
}
