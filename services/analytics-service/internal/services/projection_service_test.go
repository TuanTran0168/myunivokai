package services

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/models"
)

var eventTimestamp = time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)

func TestDNAEventsProjectOnlyTheJob(t *testing.T) {
	generated := encodeEvent(t, contracts.DNAGeneratedData{
		Family: contracts.WorldFamilyUniverse, ProfileID: "profile-1", DNAVersionID: "dna-1",
	})
	projection, err := BuildProjection(contracts.DNAGeneratedEventSubject, "job-1:dna-generate", generated)
	if err != nil {
		t.Fatalf("build projection: %v", err)
	}
	if projection.Snapshot != nil {
		t.Fatal("a dna.generated event says nothing about a world and must not touch world_projections")
	}
	if projection.Job == nil || projection.Job.Status != contracts.JobStatusProcessing {
		t.Fatalf("dna.generated must move the job to processing: %#v", projection.Job)
	}
	if projection.Job.Terminal {
		t.Fatal("dna.generated does not end a job, so it must not stamp a completion time")
	}

	failed := encodeEvent(t, contracts.DNAFailedData{
		Family: contracts.WorldFamilyNature, Code: "AI_UNAVAILABLE", Message: "provider timed out",
	})
	projection, err = BuildProjection(contracts.DNAFailedEventSubject, "job-1:dna-failed", failed)
	if err != nil {
		t.Fatalf("build projection: %v", err)
	}
	if projection.Job.Status != contracts.JobStatusFailed || !projection.Job.Terminal {
		t.Fatalf("dna.failed must be a terminal failure: %#v", projection.Job)
	}
	if projection.Job.ErrorCode != "AI_UNAVAILABLE" || projection.Job.ErrorMessage != "provider timed out" {
		t.Fatalf("dna.failed lost its diagnosis: %#v", projection.Job)
	}
}

func TestCompletedEventProjectsBothHalves(t *testing.T) {
	snapshot := sampleSnapshot()
	payload := encodeEvent(t, contracts.FamilyCompletedData{
		Family: contracts.WorldFamilyUniverse, ProfileID: "profile-1", DNAVersionID: "dna-1",
		WorldID: snapshot.WorldID, Snapshot: &snapshot,
	})
	projection, err := BuildProjection(contracts.UniverseCompletedEventSubject, "job-1:universe-completed", payload)
	if err != nil {
		t.Fatalf("build projection: %v", err)
	}
	if projection.Job == nil || projection.Job.Status != contracts.JobStatusCompleted || !projection.Job.Terminal {
		t.Fatalf("completed must end the job: %#v", projection.Job)
	}
	if projection.Snapshot == nil || projection.Snapshot.Revision != 1 {
		t.Fatalf("completed must carry the world's first snapshot: %#v", projection.Snapshot)
	}
}

// Events published before analytics-service existed have no snapshot. They
// must still project the job half rather than being rejected, or every job
// that ran before this service shipped is invisible forever.
func TestLegacyCompletedEventProjectsTheJobWithoutAWorld(t *testing.T) {
	payload := encodeEvent(t, contracts.FamilyCompletedData{
		Family: contracts.WorldFamilyNature, ProfileID: "profile-1", DNAVersionID: "dna-1", WorldID: "world-1",
	})
	projection, err := BuildProjection(contracts.NatureCompletedEventSubject, "job-1:nature-completed", payload)
	if err != nil {
		t.Fatalf("a pre-analytics completed event must still project: %v", err)
	}
	if projection.Snapshot != nil {
		t.Fatalf("expected no world half, got %#v", projection.Snapshot)
	}
	if projection.Job == nil || projection.Job.WorldID != "world-1" {
		t.Fatalf("the job half must survive: %#v", projection.Job)
	}
}

func TestWorldChangedEventProjectsOnlyTheWorld(t *testing.T) {
	snapshot := sampleSnapshot()
	snapshot.Revision = 4
	payload := encodeEvent(t, contracts.FamilyWorldChangedData{Snapshot: snapshot})
	projection, err := BuildProjection(contracts.UniverseWorldChangedEventSubject, "world-1:rev:4", payload)
	if err != nil {
		t.Fatalf("build projection: %v", err)
	}
	if projection.Job != nil {
		t.Fatal("a world.changed event carries no job lifecycle information")
	}
	if projection.Snapshot == nil || projection.Snapshot.Revision != 4 {
		t.Fatalf("world.changed must carry the new revision: %#v", projection.Snapshot)
	}
	if projection.Message.MessageID != "world-1:rev:4" {
		t.Fatalf("message identity = %q, want the publisher's outbox id", projection.Message.MessageID)
	}
}

// A world.changed event without a usable snapshot is corrupt, not merely
// empty: projecting it would blank a real row.
func TestWorldChangedEventWithoutASnapshotIsRejected(t *testing.T) {
	payload := encodeEvent(t, contracts.FamilyWorldChangedData{})
	if _, err := BuildProjection(contracts.NatureWorldChangedEventSubject, "world-1:rev:2", payload); err == nil {
		t.Fatal("expected an empty snapshot to be rejected")
	}
}

// The durable consumer filters on the wildcard `myunivokai.events.>`, so a
// subject some future service introduces lands here. It must be reported as
// unknown so the consumer acks and moves on rather than redelivering forever.
func TestUnknownSubjectIsReportedRatherThanFailing(t *testing.T) {
	_, err := BuildProjection("myunivokai.events.forest.completed.v1", "message-1", []byte(`{"jobId":"j","timestamp":"2026-08-07T12:00:00Z","data":{}}`))
	if !errors.Is(err, ErrUnknownSubject) {
		t.Fatalf("error = %v, want ErrUnknownSubject", err)
	}
}

func TestMalformedPayloadIsRejected(t *testing.T) {
	if _, err := BuildProjection(contracts.DNAGeneratedEventSubject, "message-1", []byte("not json")); err == nil {
		t.Fatal("expected malformed JSON to be rejected")
	}
	// An envelope with no jobId cannot be attributed to a job, so it must not
	// silently create a row keyed on the empty string.
	if _, err := BuildProjection(contracts.DNAGeneratedEventSubject, "message-1", []byte(`{"timestamp":"2026-08-07T12:00:00Z","data":{}}`)); err == nil {
		t.Fatal("expected an envelope without a job id to be rejected")
	}
}

func TestApplyDelegatesToTheStoreAndReportsDuplicates(t *testing.T) {
	store := &recordingStore{}
	service := NewProjectionService(store)
	payload := encodeEvent(t, contracts.FamilyWorldChangedData{Snapshot: sampleSnapshot()})

	applied, err := service.Apply(context.Background(), contracts.UniverseWorldChangedEventSubject, "world-1:rev:1", payload)
	if err != nil || !applied {
		t.Fatalf("first delivery: applied=%v err=%v", applied, err)
	}
	applied, err = service.Apply(context.Background(), contracts.UniverseWorldChangedEventSubject, "world-1:rev:1", payload)
	if err != nil {
		t.Fatalf("duplicate delivery must not be an error: %v", err)
	}
	if applied {
		t.Fatal("the second delivery of the same message id must report as already applied")
	}
	if len(store.seen) != 1 {
		t.Fatalf("store wrote %d times for the same message, want 1", len(store.seen))
	}
}

func sampleSnapshot() contracts.WorldSnapshot {
	return contracts.WorldSnapshot{
		WorldID: "world-1", Family: contracts.WorldFamilyUniverse, ProfileID: "profile-1",
		DNAVersionID: "dna-1", SourceJobID: "job-1", Revision: 1, Nickname: "Nova",
		Archetype: "Curious Builder", SceneName: "Nova's Living Horizon", Mood: "curious",
		WorldStyle: "nebula", FavoriteColors: []string{"#8B5CF6"},
		TraitScores:  contracts.TraitScores{Creativity: 82, Discipline: 76, Curiosity: 91, Energy: 70, Focus: 84},
		VariantCount: 1, SelectedVariantNo: 1, WorldCreatedAt: eventTimestamp,
	}
}

func encodeEvent[DataType any](t *testing.T, data DataType) []byte {
	t.Helper()
	payload, err := json.Marshal(contracts.Envelope[DataType]{JobID: "job-1", Timestamp: eventTimestamp, Data: data})
	if err != nil {
		t.Fatalf("encode event: %v", err)
	}
	return payload
}

// recordingStore implements only what ProjectionService touches. Every read
// method panics: reaching one would mean the write path had started querying,
// which this service's design forbids.
type recordingStore struct {
	seen map[string]struct{}
}

func (store *recordingStore) Apply(_ context.Context, projection models.Projection) (bool, error) {
	if store.seen == nil {
		store.seen = map[string]struct{}{}
	}
	if _, found := store.seen[projection.Message.MessageID]; found {
		return false, nil
	}
	store.seen[projection.Message.MessageID] = struct{}{}
	return true, nil
}

func (store *recordingStore) Overview(context.Context, models.OverviewFilter) (contracts.AnalyticsOverviewResponseData, error) {
	panic("the projection path must never read")
}

func (store *recordingStore) ListWorlds(context.Context, models.WorldListFilter) (contracts.AnalyticsWorldListResponseData, error) {
	panic("the projection path must never read")
}

func (store *recordingStore) ListJobs(context.Context, models.JobListFilter) (contracts.AnalyticsJobListResponseData, error) {
	panic("the projection path must never read")
}

func (store *recordingStore) Timeseries(context.Context, models.OverviewFilter) (contracts.AnalyticsTimeseriesResponseData, error) {
	panic("the projection path must never read")
}

func (store *recordingStore) Ping(context.Context) error { return nil }
