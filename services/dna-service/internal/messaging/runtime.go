package messaging

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/config"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/handlers"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/services"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const (
	dnaGenerateDurableName  = "dna-generate-v1"
	dnaResultsDurableName   = "dna-family-results-v1"
	dnaGenerateMessageStage = ":dna-generate"
	requestQueueName        = "dna-service-v1"
)

type Runtime struct {
	config        config.Config
	connection    *nats.Conn
	jetStream     nats.JetStreamContext
	store         repositories.Store
	natsHandler   *handlers.NATSHandler
	subscriptions []*nats.Subscription
	waitGroup     sync.WaitGroup
}

func NewRuntime(serviceConfig config.Config, store repositories.Store, generationService *services.GenerationService) (*Runtime, error) {
	connectionOptions := []nats.Option{
		nats.Name("myunivokai-dna"),
		nats.Timeout(serviceConfig.NATSConnectTimeout),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(serviceConfig.NATSReconnectWait),
	}

	credsData := ""
	if strings.HasPrefix(strings.TrimSpace(serviceConfig.NATSCredentialsFile), "-----BEGIN") {
		credsData = serviceConfig.NATSCredentialsFile
	} else if strings.HasPrefix(strings.TrimSpace(serviceConfig.NATSPassword), "-----BEGIN") {
		credsData = serviceConfig.NATSPassword
	}

	if credsData != "" {
		tempFile, err := os.CreateTemp("", "nats-*.creds")
		if err == nil {
			defer os.Remove(tempFile.Name())
			_, _ = tempFile.WriteString(credsData)
			_ = tempFile.Close()
			connectionOptions = append(connectionOptions, nats.UserCredentials(tempFile.Name()))
		}
	} else if serviceConfig.NATSCredentialsFile != "" {
		connectionOptions = append(connectionOptions, nats.UserCredentials(serviceConfig.NATSCredentialsFile))
	} else if strings.HasPrefix(strings.TrimSpace(serviceConfig.NATSPassword), "nhg_") || strings.HasPrefix(strings.TrimSpace(serviceConfig.NATSPassword), "eyJ") {
		connectionOptions = append(connectionOptions, nats.Token(strings.TrimSpace(serviceConfig.NATSPassword)))
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
		natsHandler: handlers.NewNATSHandler(generationService, connection, serviceConfig.QueryTimeout),
	}, nil
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
	runtime.subscriptions = append(runtime.subscriptions, generateSubscription)
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
		nats.MaxDeliver(-1),
	)
	if err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("subscribe family events: %w", err)
	}
	runtime.subscriptions = append(runtime.subscriptions, resultsSubscription)
	jobQuerySubscription, err := runtime.connection.QueueSubscribe(contracts.DNAJobGetQuerySubject, requestQueueName, runtime.natsHandler.HandleJobQuery)
	if err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("subscribe job query: %w", err)
	}
	runtime.subscriptions = append(runtime.subscriptions, jobQuerySubscription)
	if err := runtime.connection.FlushTimeout(runtime.config.NATSConnectTimeout); err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("flush DNA subscriptions: %w", err)
	}
	runtime.waitGroup.Add(3)
	go runtime.consume(ctx, generateSubscription, runtime.natsHandler.HandleGenerate, runtime.handleTerminalGenerationFailure)
	go runtime.consume(ctx, resultsSubscription, runtime.natsHandler.HandleFamilyResult, nil)
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

func (runtime *Runtime) consume(
	ctx context.Context,
	subscription *nats.Subscription,
	handler func(context.Context, *nats.Msg) error,
	terminalHandler func(context.Context, *nats.Msg),
) {
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
			log.Error().Err(err).Msg("fetch NATS message")
			continue
		}
		for _, message := range messages {
			if err := handler(ctx, message); err != nil {
				metadata, metadataError := message.Metadata()
				if terminalHandler != nil && metadataError == nil && int(metadata.NumDelivered) >= runtime.config.ConsumerMaximumDeliveries {
					log.Error().Err(err).Str("subject", message.Subject).Msg("NATS message reached maximum deliveries")
					terminalHandler(ctx, message)
					continue
				}
				_ = message.NakWithDelay(runtime.config.ConsumerRetryDelay)
				continue
			}
			_ = message.Ack()
		}
	}
}

func (runtime *Runtime) handleTerminalGenerationFailure(ctx context.Context, message *nats.Msg) {
	for {
		if err := runtime.natsHandler.HandleGenerationFailure(ctx, message); err == nil {
			_ = message.Term()
			return
		} else if errors.Is(err, handlers.ErrInvalidGenerateCommand) {
			log.Error().Err(err).Msg("discard invalid DNA generation command")
			_ = message.Term()
			return
		} else {
			log.Error().Err(err).Msg("record terminal DNA generation failure")
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

func DNAGenerateMessageID(jobID string) string {
	return jobID + dnaGenerateMessageStage
}
