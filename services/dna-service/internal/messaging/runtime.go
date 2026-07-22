package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/config"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/services"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const (
	dnaGenerateDurableName  = "dna-generate-v1"
	dnaResultsDurableName   = "dna-family-results-v1"
	dnaGenerateMessageStage = ":dna-generate"
	pullFetchBatchSize      = 1
	pullFetchMaximumWait    = time.Second
	retryDelay              = 2 * time.Second
	requestQueueName        = "dna-service-v1"
)

type Runtime struct {
	config            config.Config
	connection        *nats.Conn
	jetStream         nats.JetStreamContext
	store             repositories.Store
	generationService *services.GenerationService
	subscriptions     []*nats.Subscription
	waitGroup         sync.WaitGroup
}

func NewRuntime(serviceConfig config.Config, store repositories.Store, generationService *services.GenerationService) (*Runtime, error) {
	connectionOptions := []nats.Option{nats.Name("myunivokai-dna")}
	if serviceConfig.NATSCredentialsFile != "" {
		connectionOptions = append(connectionOptions, nats.UserCredentials(serviceConfig.NATSCredentialsFile))
	} else if serviceConfig.NATSUsername != "" {
		connectionOptions = append(connectionOptions, nats.UserInfo(serviceConfig.NATSUsername, serviceConfig.NATSPassword))
	}
	connection, err := nats.Connect(serviceConfig.NATSURL, connectionOptions...)
	if err != nil {
		return nil, err
	}
	jetStream, err := connection.JetStream()
	if err != nil {
		connection.Close()
		return nil, err
	}
	return &Runtime{config: serviceConfig, connection: connection, jetStream: jetStream, store: store, generationService: generationService}, nil
}

func (runtime *Runtime) Run(ctx context.Context) error {
	generateSubscription, err := runtime.jetStream.PullSubscribe(
		contracts.GenerateDNACommandSubject,
		dnaGenerateDurableName,
		nats.BindStream(contracts.CommandsStream),
		nats.ManualAck(),
		nats.AckWait(runtime.config.ConsumerAckWait),
		nats.MaxDeliver(runtime.config.ConsumerMaximumDeliveries),
	)
	if err != nil {
		return fmt.Errorf("subscribe dna commands: %w", err)
	}
	resultsSubscription, err := runtime.jetStream.PullSubscribe(
		"",
		dnaResultsDurableName,
		nats.BindStream(contracts.EventsStream),
		nats.ConsumerFilterSubjects(
			contracts.UniverseCompletedEventSubject,
			contracts.UniverseFailedEventSubject,
			contracts.NatureCompletedEventSubject,
			contracts.NatureFailedEventSubject,
		),
		nats.ManualAck(),
		nats.AckWait(runtime.config.ConsumerAckWait),
		nats.MaxDeliver(runtime.config.ConsumerMaximumDeliveries),
	)
	if err != nil {
		return fmt.Errorf("subscribe family events: %w", err)
	}
	jobQuerySubscription, err := runtime.connection.QueueSubscribe(contracts.DNAJobGetQuerySubject, requestQueueName, runtime.handleJobQuery)
	if err != nil {
		return fmt.Errorf("subscribe job query: %w", err)
	}
	runtime.subscriptions = append(runtime.subscriptions, generateSubscription, resultsSubscription, jobQuerySubscription)
	runtime.waitGroup.Add(3)
	go runtime.consume(ctx, generateSubscription, runtime.handleGenerateMessage)
	go runtime.consume(ctx, resultsSubscription, runtime.handleResultMessage)
	go runtime.publishOutbox(ctx)
	return nil
}

func (runtime *Runtime) Close() {
	for _, subscription := range runtime.subscriptions {
		_ = subscription.Unsubscribe()
	}
	runtime.waitGroup.Wait()
	_ = runtime.connection.Drain()
	runtime.connection.Close()
}

func (runtime *Runtime) consume(ctx context.Context, subscription *nats.Subscription, handler func(context.Context, *nats.Msg) error) {
	defer runtime.waitGroup.Done()
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		messages, err := subscription.Fetch(pullFetchBatchSize, nats.MaxWait(pullFetchMaximumWait))
		if err != nil {
			if errors.Is(err, nats.ErrTimeout) || errors.Is(err, context.DeadlineExceeded) {
				continue
			}
			log.Error().Err(err).Msg("fetch NATS message")
			continue
		}
		for _, message := range messages {
			if err := handler(ctx, message); err != nil {
				metadata, metadataError := message.Metadata()
				if metadataError == nil && int(metadata.NumDelivered) >= runtime.config.ConsumerMaximumDeliveries {
					log.Error().Err(err).Str("subject", message.Subject).Msg("NATS message reached maximum deliveries")
					_ = message.Term()
					continue
				}
				_ = message.NakWithDelay(retryDelay)
				continue
			}
			_ = message.Ack()
		}
	}
}

func (runtime *Runtime) handleGenerateMessage(ctx context.Context, message *nats.Msg) error {
	var envelope contracts.Envelope[contracts.GenerateDNAData]
	if err := json.Unmarshal(message.Data, &envelope); err != nil {
		return fmt.Errorf("decode dna command: %w", err)
	}
	return runtime.generationService.Generate(ctx, envelope)
}

func (runtime *Runtime) handleResultMessage(ctx context.Context, message *nats.Msg) error {
	messageID := message.Header.Get(nats.MsgIdHdr)
	if messageID == "" {
		metadata, err := message.Metadata()
		if err != nil {
			return err
		}
		messageID = fmt.Sprintf("%s:%d", message.Subject, metadata.Sequence.Stream)
	}
	switch message.Subject {
	case contracts.UniverseCompletedEventSubject, contracts.NatureCompletedEventSubject:
		var envelope contracts.Envelope[contracts.FamilyCompletedData]
		if err := json.Unmarshal(message.Data, &envelope); err != nil {
			return err
		}
		return runtime.generationService.CompleteFamily(ctx, messageID, message.Subject, envelope)
	case contracts.UniverseFailedEventSubject, contracts.NatureFailedEventSubject:
		var envelope contracts.Envelope[contracts.FamilyFailedData]
		if err := json.Unmarshal(message.Data, &envelope); err != nil {
			return err
		}
		return runtime.generationService.FailFamily(ctx, messageID, message.Subject, envelope)
	default:
		return nil
	}
}

func (runtime *Runtime) handleJobQuery(message *nats.Msg) {
	if strings.TrimSpace(message.Reply) == "" {
		return
	}
	var envelope contracts.Envelope[contracts.JobQueryData]
	if err := json.Unmarshal(message.Data, &envelope); err != nil {
		runtime.respond(message, contracts.ErrorRPCEnvelope("invalid-request", http.StatusBadRequest, "INVALID_REQUEST", "The job query is invalid."))
		return
	}
	queryContext, cancel := context.WithTimeout(context.Background(), runtime.config.QueryTimeout)
	defer cancel()
	job, err := runtime.generationService.GetJob(queryContext, envelope.Data.JobID)
	if errors.Is(err, repositories.ErrNotFound) {
		runtime.respond(message, contracts.ErrorRPCEnvelope(envelope.JobID, http.StatusNotFound, "JOB_NOT_FOUND", "The requested job was not found."))
		return
	}
	if err != nil {
		runtime.respond(message, contracts.ErrorRPCEnvelope(envelope.JobID, http.StatusServiceUnavailable, "JOB_QUERY_UNAVAILABLE", "The job could not be loaded."))
		return
	}
	responseEnvelope, err := contracts.SuccessRPCEnvelope(envelope.JobID, http.StatusOK, job)
	if err != nil {
		runtime.respond(message, contracts.ErrorRPCEnvelope(envelope.JobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The response could not be created."))
		return
	}
	runtime.respond(message, responseEnvelope)
}

func (runtime *Runtime) respond(message *nats.Msg, response any) {
	payload, err := json.Marshal(response)
	if err != nil {
		log.Error().Err(err).Msg("marshal NATS query response")
		return
	}
	if err := runtime.connection.Publish(message.Reply, payload); err != nil {
		log.Error().Err(err).Msg("publish NATS query response")
	}
}

func (runtime *Runtime) publishOutbox(ctx context.Context) {
	defer runtime.waitGroup.Done()
	ticker := time.NewTicker(runtime.config.OutboxPollInterval)
	defer ticker.Stop()
	for {
		if err := runtime.publishOutboxBatch(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Error().Err(err).Msg("publish DNA outbox batch")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (runtime *Runtime) publishOutboxBatch(ctx context.Context) error {
	messages, err := runtime.store.PendingOutbox(ctx, runtime.config.OutboxBatchSize)
	if err != nil {
		return err
	}
	for _, outboxMessage := range messages {
		message := nats.NewMsg(outboxMessage.Subject)
		message.Header.Set(nats.MsgIdHdr, outboxMessage.MessageID)
		message.Data = outboxMessage.Payload
		if _, err := runtime.jetStream.PublishMsg(message); err != nil {
			return err
		}
		if err := runtime.store.MarkOutboxPublished(ctx, outboxMessage.ID); err != nil {
			return err
		}
	}
	return nil
}

func DNAGenerateMessageID(jobID string) string {
	return jobID + dnaGenerateMessageStage
}
