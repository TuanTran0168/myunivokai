package repositories

import (
	"context"
	"encoding/json"
	"errors"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/ai"
)

var ErrNotFound = errors.New("not found")

type JobRecord struct {
	Job     contracts.Job
	Input   contracts.WorldInput
	Created bool
}

type OutboxMessage struct {
	ID        string
	MessageID string
	Subject   string
	Payload   json.RawMessage
}

type Store interface {
	EnsureJob(context.Context, contracts.Envelope[contracts.GenerateDNAData]) (JobRecord, error)
	MarkJobProcessing(context.Context, string) error
	StoreDNAAndQueueComposition(context.Context, string, contracts.WorldInput, contracts.ProfileDNA, []ai.Attempt) (contracts.Job, error)
	FailDNAJob(context.Context, string, contracts.WorldFamily, string, string, []ai.Attempt) error
	ApplyFamilyCompleted(context.Context, string, string, contracts.Envelope[contracts.FamilyCompletedData]) error
	ApplyFamilyFailed(context.Context, string, string, contracts.Envelope[contracts.FamilyFailedData]) error
	GetJob(context.Context, string) (contracts.Job, error)
	PendingOutbox(context.Context, int) ([]OutboxMessage, error)
	MarkOutboxPublished(context.Context, string) error
	Ping(context.Context) error
}
