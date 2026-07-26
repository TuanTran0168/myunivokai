package messaging

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/config"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/handlers"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/services"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const (
	composeDurableName = "universe-compose-v1"
	queryQueueName     = "universe-service-v1"
)

type queryBinding struct {
	subject string
	handler nats.MsgHandler
}

type Runtime struct {
	config        config.Config
	connection    *nats.Conn
	jetStream     nats.JetStreamContext
	store         repositories.Store
	natsHandler   *handlers.NATSHandler
	subscriptions []*nats.Subscription
	waitGroup     sync.WaitGroup
}

func NewRuntime(serviceConfig config.Config, store repositories.Store, worldService *services.WorldService) (*Runtime, error) {
	connectionOptions := []nats.Option{
		nats.Name("myunivokai-universe"),
		nats.Timeout(serviceConfig.NATSConnectTimeout),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(serviceConfig.NATSReconnectWait),
	}
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
	return &Runtime{
		config: serviceConfig, connection: connection, jetStream: jetStream, store: store,
		natsHandler: handlers.NewNATSHandler(worldService, connection, jetStream, serviceConfig.QueryTimeout),
	}, nil
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
	queryBindings := []queryBinding{
		{subject: contracts.UniverseWorldListQuerySubject, handler: runtime.natsHandler.HandleWorldListQuery},
		{subject: contracts.UniverseWorldGetQuerySubject, handler: runtime.natsHandler.HandleWorldGetQuery},
		{subject: contracts.UniverseVariantCreateSubject, handler: runtime.natsHandler.HandleVariantCreateQuery},
		{subject: contracts.UniverseVariantSelectSubject, handler: runtime.natsHandler.HandleVariantSelectQuery},
		{subject: contracts.UniverseWorldPublishSubject, handler: runtime.natsHandler.HandleWorldPublishQuery},
		{subject: contracts.UniverseShareGetQuerySubject, handler: runtime.natsHandler.HandleShareGetQuery},
	}
	for _, binding := range queryBindings {
		subscription, subscribeError := runtime.connection.QueueSubscribe(binding.subject, queryQueueName, binding.handler)
		if subscribeError != nil {
			runtime.unsubscribeAll()
			return fmt.Errorf("subscribe universe query %s: %w", binding.subject, subscribeError)
		}
		runtime.subscriptions = append(runtime.subscriptions, subscription)
	}
	if err := runtime.connection.FlushTimeout(runtime.config.NATSConnectTimeout); err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("flush universe subscriptions: %w", err)
	}
	runtime.waitGroup.Add(2)
	go runtime.consumeCompositions(ctx, composeSubscription)
	go runtime.publishOutbox(ctx)
	return nil
}

func (runtime *Runtime) Close() {
	runtime.unsubscribeAll()
	runtime.waitGroup.Wait()
	_ = runtime.connection.Drain()
	runtime.connection.Close()
}

func (runtime *Runtime) unsubscribeAll() {
	for _, subscription := range runtime.subscriptions {
		_ = subscription.Unsubscribe()
	}
	runtime.subscriptions = nil
}

func (runtime *Runtime) consumeCompositions(ctx context.Context, subscription *nats.Subscription) {
	defer runtime.waitGroup.Done()
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		messages, err := subscription.Fetch(runtime.config.ConsumerFetchBatchSize, nats.MaxWait(runtime.config.ConsumerFetchMaximumWait))
		if err != nil {
			if errors.Is(err, nats.ErrTimeout) || errors.Is(err, context.DeadlineExceeded) {
				continue
			}
			log.Error().Err(err).Msg("fetch universe composition")
			continue
		}
		for _, message := range messages {
			if err := runtime.natsHandler.HandleComposition(ctx, message); err != nil {
				metadata, metadataError := message.Metadata()
				if metadataError == nil && int(metadata.NumDelivered) >= runtime.config.ConsumerMaximumDeliveries {
					runtime.publishTerminalCompositionFailure(ctx, message)
					continue
				}
				_ = message.NakWithDelay(runtime.config.ConsumerRetryDelay)
				continue
			}
			_ = message.Ack()
		}
	}
}

func (runtime *Runtime) publishTerminalCompositionFailure(ctx context.Context, message *nats.Msg) {
	for {
		publishContext, cancel := context.WithTimeout(ctx, runtime.config.NATSPublishTimeout)
		err := runtime.natsHandler.PublishCompositionFailure(publishContext, message)
		cancel()
		if err == nil {
			_ = message.Term()
			return
		} else if errors.Is(err, handlers.ErrInvalidCompositionCommand) {
			log.Error().Err(err).Msg("discard invalid universe composition command")
			_ = message.Term()
			return
		} else {
			log.Error().Err(err).Msg("publish terminal universe failure")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(runtime.config.ConsumerRetryDelay):
		}
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
		publishContext, cancel := context.WithTimeout(ctx, runtime.config.NATSPublishTimeout)
		_, publishError := runtime.jetStream.PublishMsg(message, nats.Context(publishContext))
		cancel()
		if publishError != nil {
			return publishError
		}
		if err := runtime.store.MarkOutboxPublished(ctx, outboxMessage.ID); err != nil {
			return err
		}
	}
	return nil
}
