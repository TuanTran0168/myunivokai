package messaging

import (
	"context"
	"fmt"
	"sync"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/config"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/handlers"
	"github.com/nats-io/nats.go"
)

const queryQueueName = "auth-service-v1"

type queryBinding struct {
	subject string
	handler nats.MsgHandler
}

// Runtime is a pure Core NATS request-reply worker: unlike the family
// services, auth-service never accepts a JetStream command and publishes no
// domain event, so there is no PullSubscribe and no outbox loop to run.
type Runtime struct {
	config        config.Config
	connection    *nats.Conn
	natsHandler   *handlers.NATSHandler
	subscriptions []*nats.Subscription
	waitGroup     sync.WaitGroup
}

func NewRuntime(serviceConfig config.Config, authService handlers.AuthService) (*Runtime, error) {
	connectionOptions := []nats.Option{
		nats.Name("myunivokai-auth"),
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
	return &Runtime{
		config:      serviceConfig,
		connection:  connection,
		natsHandler: handlers.NewNATSHandler(authService, connection, serviceConfig.QueryTimeout),
	}, nil
}

// Run's context parameter matches every other service's Runtime.Run
// signature for interchangeability from main.go, even though this runtime
// starts no background goroutine that would need to observe cancellation.
func (runtime *Runtime) Run(_ context.Context) error {
	queryBindings := []queryBinding{
		{subject: contracts.AuthLoginQuerySubject, handler: runtime.natsHandler.HandleLoginQuery},
		{subject: contracts.AuthRefreshQuerySubject, handler: runtime.natsHandler.HandleRefreshQuery},
		{subject: contracts.AuthLogoutQuerySubject, handler: runtime.natsHandler.HandleLogoutQuery},
		{subject: contracts.AuthTokenVersionQuerySubject, handler: runtime.natsHandler.HandleTokenVersionQuery},
		{subject: contracts.AuthAccountDisableQuerySubject, handler: runtime.natsHandler.HandleAccountDisableQuery},
		{subject: contracts.AuthAccountEnableQuerySubject, handler: runtime.natsHandler.HandleAccountEnableQuery},
	}
	for _, binding := range queryBindings {
		subscription, err := runtime.connection.QueueSubscribe(binding.subject, queryQueueName, binding.handler)
		if err != nil {
			runtime.unsubscribeAll()
			return fmt.Errorf("subscribe auth query %s: %w", binding.subject, err)
		}
		runtime.subscriptions = append(runtime.subscriptions, subscription)
	}
	if err := runtime.connection.FlushTimeout(runtime.config.NATSConnectTimeout); err != nil {
		runtime.unsubscribeAll()
		return fmt.Errorf("flush auth subscriptions: %w", err)
	}
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
