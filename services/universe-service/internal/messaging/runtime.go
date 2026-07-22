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
	"github.com/myunivokai/myunivokai/services/universe-service/internal/config"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/services"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const (
	composeDurableName       = "universe-compose-v1"
	queryQueueName           = "universe-service-v1"
	pullFetchBatchSize       = 1
	pullFetchMaximumWait     = time.Second
	retryDelay               = 2 * time.Second
	failedOutboxMessageStage = ":universe-failed"
	compositionFailedCode    = "UNIVERSE_COMPOSITION_FAILED"
	compositionFailedMessage = "The universe could not be composed. Please try again."
)

type Runtime struct {
	config        config.Config
	connection    *nats.Conn
	jetStream     nats.JetStreamContext
	store         repositories.Store
	worldService  *services.WorldService
	subscriptions []*nats.Subscription
	waitGroup     sync.WaitGroup
}

func NewRuntime(serviceConfig config.Config, store repositories.Store, worldService *services.WorldService) (*Runtime, error) {
	connectionOptions := []nats.Option{nats.Name("myunivokai-universe")}
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
	return &Runtime{config: serviceConfig, connection: connection, jetStream: jetStream, store: store, worldService: worldService}, nil
}

func (runtime *Runtime) Run(ctx context.Context) error {
	composeSubscription, err := runtime.jetStream.PullSubscribe(
		contracts.ComposeUniverseCommandSubject,
		composeDurableName,
		nats.BindStream(contracts.CommandsStream),
		nats.ManualAck(),
		nats.AckWait(runtime.config.ConsumerAckWait),
		nats.MaxDeliver(runtime.config.ConsumerMaximumDeliveries),
	)
	if err != nil {
		return fmt.Errorf("subscribe universe commands: %w", err)
	}
	runtime.subscriptions = append(runtime.subscriptions, composeSubscription)
	queryHandlers := map[string]nats.MsgHandler{
		contracts.UniverseWorldListQuerySubject: runtime.handleWorldListQuery,
		contracts.UniverseWorldGetQuerySubject:  runtime.handleWorldGetQuery,
		contracts.UniverseVariantCreateSubject:  runtime.handleVariantCreateQuery,
		contracts.UniverseVariantSelectSubject:  runtime.handleVariantSelectQuery,
		contracts.UniverseWorldPublishSubject:   runtime.handleWorldPublishQuery,
		contracts.UniverseShareGetQuerySubject:  runtime.handleShareGetQuery,
	}
	for subject, handler := range queryHandlers {
		subscription, subscribeError := runtime.connection.QueueSubscribe(subject, queryQueueName, handler)
		if subscribeError != nil {
			return fmt.Errorf("subscribe universe query %s: %w", subject, subscribeError)
		}
		runtime.subscriptions = append(runtime.subscriptions, subscription)
	}
	runtime.waitGroup.Add(2)
	go runtime.consumeCompositions(ctx, composeSubscription)
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

func (runtime *Runtime) consumeCompositions(ctx context.Context, subscription *nats.Subscription) {
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
			log.Error().Err(err).Msg("fetch universe composition")
			continue
		}
		for _, message := range messages {
			if err := runtime.handleComposition(ctx, message); err != nil {
				metadata, metadataError := message.Metadata()
				if metadataError == nil && int(metadata.NumDelivered) >= runtime.config.ConsumerMaximumDeliveries {
					runtime.publishCompositionFailure(message)
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

func (runtime *Runtime) handleComposition(ctx context.Context, message *nats.Msg) error {
	var envelope contracts.Envelope[contracts.ComposeWorldData]
	if err := json.Unmarshal(message.Data, &envelope); err != nil {
		return fmt.Errorf("decode universe command: %w", err)
	}
	_, err := runtime.worldService.ComposeWorld(ctx, envelope)
	return err
}

func (runtime *Runtime) publishCompositionFailure(message *nats.Msg) {
	var composeEnvelope contracts.Envelope[contracts.ComposeWorldData]
	if err := json.Unmarshal(message.Data, &composeEnvelope); err != nil || composeEnvelope.JobID == "" {
		log.Error().Err(err).Msg("cannot publish universe failure for invalid command")
		return
	}
	failedEnvelope := contracts.NewEnvelope(composeEnvelope.JobID, contracts.FamilyFailedData{
		Family: contracts.WorldFamilyUniverse, ProfileID: composeEnvelope.Data.ProfileID, DNAVersionID: composeEnvelope.Data.DNAVersionID,
		Code: compositionFailedCode, Message: compositionFailedMessage,
	})
	payload, err := json.Marshal(failedEnvelope)
	if err != nil {
		return
	}
	failedMessage := nats.NewMsg(contracts.UniverseFailedEventSubject)
	failedMessage.Header.Set(nats.MsgIdHdr, composeEnvelope.JobID+failedOutboxMessageStage)
	failedMessage.Data = payload
	if _, err := runtime.jetStream.PublishMsg(failedMessage); err != nil {
		log.Error().Err(err).Str("job_id", composeEnvelope.JobID).Msg("publish universe failed event")
	}
}

func (runtime *Runtime) handleWorldListQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.WorldListQueryData]
	if !runtime.decodeQuery(message, &envelope) {
		return
	}
	queryContext, cancel := context.WithTimeout(context.Background(), runtime.config.QueryTimeout)
	defer cancel()
	response, err := runtime.worldService.GetWorlds(queryContext, envelope.Data.WorldIDs)
	runtime.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (runtime *Runtime) handleWorldGetQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.WorldQueryData]
	if !runtime.decodeQuery(message, &envelope) {
		return
	}
	queryContext, cancel := context.WithTimeout(context.Background(), runtime.config.QueryTimeout)
	defer cancel()
	response, err := runtime.worldService.GetWorld(queryContext, envelope.Data.WorldID)
	runtime.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (runtime *Runtime) handleVariantCreateQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.VariantCreateData]
	if !runtime.decodeQuery(message, &envelope) {
		return
	}
	queryContext, cancel := context.WithTimeout(context.Background(), runtime.config.QueryTimeout)
	defer cancel()
	response, err := runtime.worldService.RegenerateVariant(queryContext, envelope.Data.WorldID)
	runtime.respondWithResult(message, envelope.JobID, http.StatusCreated, response, err)
}

func (runtime *Runtime) handleVariantSelectQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.VariantSelectData]
	if !runtime.decodeQuery(message, &envelope) {
		return
	}
	queryContext, cancel := context.WithTimeout(context.Background(), runtime.config.QueryTimeout)
	defer cancel()
	response, err := runtime.worldService.SelectVariant(queryContext, envelope.Data.WorldID, envelope.Data.VariantID)
	runtime.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (runtime *Runtime) handleWorldPublishQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.PublishWorldData]
	if !runtime.decodeQuery(message, &envelope) {
		return
	}
	queryContext, cancel := context.WithTimeout(context.Background(), runtime.config.QueryTimeout)
	defer cancel()
	response, err := runtime.worldService.PublishWorld(queryContext, envelope.Data.WorldID)
	runtime.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (runtime *Runtime) handleShareGetQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.ShareQueryData]
	if !runtime.decodeQuery(message, &envelope) {
		return
	}
	queryContext, cancel := context.WithTimeout(context.Background(), runtime.config.QueryTimeout)
	defer cancel()
	response, err := runtime.worldService.GetPublicWorld(queryContext, envelope.Data.ShareSlug)
	runtime.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (runtime *Runtime) decodeQuery(message *nats.Msg, envelope any) bool {
	if strings.TrimSpace(message.Reply) == "" {
		return false
	}
	if err := json.Unmarshal(message.Data, envelope); err != nil {
		runtime.respond(message, contracts.ErrorRPCEnvelope("invalid-request", http.StatusBadRequest, "INVALID_REQUEST", "The internal request is invalid."))
		return false
	}
	return true
}

func (runtime *Runtime) respondWithResult(message *nats.Msg, jobID string, successStatus int, payload any, err error) {
	if errors.Is(err, repositories.ErrNotFound) {
		runtime.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found."))
		return
	}
	if errors.Is(err, repositories.ErrConflict) {
		runtime.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusConflict, "WORLD_CONFLICT", "The world was changed by another request. Please retry."))
		return
	}
	if err != nil {
		log.Error().Err(err).Str("request_id", jobID).Msg("universe query failed")
		runtime.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The request could not be completed."))
		return
	}
	responseEnvelope, marshalError := contracts.SuccessRPCEnvelope(jobID, successStatus, payload)
	if marshalError != nil {
		runtime.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The response could not be created."))
		return
	}
	runtime.respond(message, responseEnvelope)
}

func (runtime *Runtime) respond(message *nats.Msg, response any) {
	payload, err := json.Marshal(response)
	if err != nil {
		log.Error().Err(err).Msg("marshal universe NATS response")
		return
	}
	if err := runtime.connection.Publish(message.Reply, payload); err != nil {
		log.Error().Err(err).Msg("publish universe NATS response")
	}
}

func (runtime *Runtime) publishOutbox(ctx context.Context) {
	defer runtime.waitGroup.Done()
	ticker := time.NewTicker(runtime.config.OutboxPollInterval)
	defer ticker.Stop()
	for {
		if err := runtime.publishOutboxBatch(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Error().Err(err).Msg("publish universe outbox batch")
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
