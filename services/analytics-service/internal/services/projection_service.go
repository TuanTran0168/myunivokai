package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/models"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/repositories"
)

// ErrUnknownSubject means the consumer received something outside the set of
// events this projection understands. The consumer's durable filter is the
// wildcard `myunivokai.events.>`, so a subject added by another service in
// the future arrives here first — and must be skipped, not retried forever.
var ErrUnknownSubject = errors.New("unknown event subject")

type ProjectionService struct {
	store repositories.Store
}

func NewProjectionService(store repositories.Store) *ProjectionService {
	return &ProjectionService{store: store}
}

// Apply projects one delivered event. The bool reports whether the event was
// new; a false is a duplicate JetStream delivery, which is expected traffic
// rather than an error.
func (service *ProjectionService) Apply(ctx context.Context, subject, messageID string, payload []byte) (bool, error) {
	projection, err := BuildProjection(subject, messageID, payload)
	if err != nil {
		return false, err
	}
	return service.store.Apply(ctx, projection)
}

// BuildProjection is a pure function on purpose: mapping an event to its
// effect on the read model is the part of this service most worth testing,
// and it needs no database to do so.
func BuildProjection(subject, messageID string, payload []byte) (models.Projection, error) {
	switch subject {
	case contracts.DNAGeneratedEventSubject:
		envelope, err := decodeEnvelope[contracts.DNAGeneratedData](payload)
		if err != nil {
			return models.Projection{}, err
		}
		return models.Projection{
			Message: inboxMessage(messageID, subject, envelope.JobID),
			Job: &models.JobEvent{
				JobID: envelope.JobID, Family: envelope.Data.Family, Status: contracts.JobStatusProcessing,
				ProfileID: envelope.Data.ProfileID, DNAVersionID: envelope.Data.DNAVersionID,
				OccurredAt: envelope.Timestamp,
			},
		}, nil

	case contracts.DNAFailedEventSubject:
		envelope, err := decodeEnvelope[contracts.DNAFailedData](payload)
		if err != nil {
			return models.Projection{}, err
		}
		return models.Projection{
			Message: inboxMessage(messageID, subject, envelope.JobID),
			Job: &models.JobEvent{
				JobID: envelope.JobID, Family: envelope.Data.Family, Status: contracts.JobStatusFailed,
				ErrorCode: envelope.Data.Code, ErrorMessage: envelope.Data.Message,
				OccurredAt: envelope.Timestamp, Terminal: true,
			},
		}, nil

	case contracts.UniverseCompletedEventSubject, contracts.NatureCompletedEventSubject:
		envelope, err := decodeEnvelope[contracts.FamilyCompletedData](payload)
		if err != nil {
			return models.Projection{}, err
		}
		// Snapshot is nil for any completed event published before
		// analytics-service existed. Those still project the job — only the
		// world half is unavailable, and no later revision will ever be
		// lower, so the first world.changed event fills it in.
		return models.Projection{
			Message: inboxMessage(messageID, subject, envelope.JobID),
			Job: &models.JobEvent{
				JobID: envelope.JobID, Family: envelope.Data.Family, Status: contracts.JobStatusCompleted,
				WorldID: envelope.Data.WorldID, ProfileID: envelope.Data.ProfileID, DNAVersionID: envelope.Data.DNAVersionID,
				OccurredAt: envelope.Timestamp, Terminal: true,
			},
			Snapshot: envelope.Data.Snapshot,
		}, nil

	case contracts.UniverseFailedEventSubject, contracts.NatureFailedEventSubject:
		envelope, err := decodeEnvelope[contracts.FamilyFailedData](payload)
		if err != nil {
			return models.Projection{}, err
		}
		return models.Projection{
			Message: inboxMessage(messageID, subject, envelope.JobID),
			Job: &models.JobEvent{
				JobID: envelope.JobID, Family: envelope.Data.Family, Status: contracts.JobStatusFailed,
				ProfileID: envelope.Data.ProfileID, DNAVersionID: envelope.Data.DNAVersionID,
				ErrorCode: envelope.Data.Code, ErrorMessage: envelope.Data.Message,
				OccurredAt: envelope.Timestamp, Terminal: true,
			},
		}, nil

	case contracts.UniverseWorldChangedEventSubject, contracts.NatureWorldChangedEventSubject:
		envelope, err := decodeEnvelope[contracts.FamilyWorldChangedData](payload)
		if err != nil {
			return models.Projection{}, err
		}
		snapshot := envelope.Data.Snapshot
		if snapshot.WorldID == "" || snapshot.Revision < 1 {
			return models.Projection{}, fmt.Errorf("world changed event on %s carries no usable snapshot", subject)
		}
		return models.Projection{
			Message:  inboxMessage(messageID, subject, envelope.JobID),
			Snapshot: &snapshot,
		}, nil

	default:
		return models.Projection{}, ErrUnknownSubject
	}
}

func inboxMessage(messageID, subject, jobID string) models.InboxMessage {
	return models.InboxMessage{MessageID: messageID, Subject: subject, JobID: jobID}
}

func decodeEnvelope[DataType any](payload []byte) (contracts.Envelope[DataType], error) {
	var envelope contracts.Envelope[DataType]
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return contracts.Envelope[DataType]{}, fmt.Errorf("decode event envelope: %w", err)
	}
	if err := envelope.Validate(); err != nil {
		return contracts.Envelope[DataType]{}, fmt.Errorf("invalid event envelope: %w", err)
	}
	return envelope, nil
}
