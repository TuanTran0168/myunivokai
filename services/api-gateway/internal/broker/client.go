package broker

import (
	"context"
	"encoding/json"
	"fmt"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/nats-io/nats.go"
)

const dnaGenerateMessageSuffix = ":dna-generate"

type Client interface {
	PublishGeneration(context.Context, contracts.Envelope[contracts.GenerateDNAData]) error
	Request(context.Context, string, any) (contracts.Envelope[contracts.RPCResponseData], error)
	Ping(context.Context) error
	Close()
}

type NATSClient struct {
	connection *nats.Conn
	jetStream  nats.JetStreamContext
}

func NewNATSClient(serviceConfig config.Config) (*NATSClient, error) {
	connectionOptions := []nats.Option{nats.Name("myunivokai-gateway")}
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
	return &NATSClient{connection: connection, jetStream: jetStream}, nil
}

func (client *NATSClient) PublishGeneration(ctx context.Context, envelope contracts.Envelope[contracts.GenerateDNAData]) error {
	payload, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("marshal generation command: %w", err)
	}
	message := nats.NewMsg(contracts.GenerateDNACommandSubject)
	message.Header.Set(nats.MsgIdHdr, envelope.JobID+dnaGenerateMessageSuffix)
	message.Data = payload
	if _, err := client.jetStream.PublishMsg(message, nats.Context(ctx)); err != nil {
		return fmt.Errorf("publish generation command: %w", err)
	}
	return nil
}

func (client *NATSClient) Request(ctx context.Context, subject string, envelope any) (contracts.Envelope[contracts.RPCResponseData], error) {
	payload, err := json.Marshal(envelope)
	if err != nil {
		return contracts.Envelope[contracts.RPCResponseData]{}, fmt.Errorf("marshal NATS request: %w", err)
	}
	message, err := client.connection.RequestWithContext(ctx, subject, payload)
	if err != nil {
		return contracts.Envelope[contracts.RPCResponseData]{}, err
	}
	var response contracts.Envelope[contracts.RPCResponseData]
	if err := json.Unmarshal(message.Data, &response); err != nil {
		return contracts.Envelope[contracts.RPCResponseData]{}, fmt.Errorf("decode NATS response: %w", err)
	}
	if err := response.Validate(); err != nil {
		return contracts.Envelope[contracts.RPCResponseData]{}, fmt.Errorf("validate NATS response: %w", err)
	}
	return response, nil
}

func (client *NATSClient) Ping(ctx context.Context) error {
	if !client.connection.IsConnected() {
		return nats.ErrDisconnected
	}
	if err := client.connection.FlushWithContext(ctx); err != nil {
		return err
	}
	_, err := client.jetStream.StreamInfo(contracts.CommandsStream, nats.Context(ctx))
	return err
}

func (client *NATSClient) Close() {
	_ = client.connection.Drain()
	client.connection.Close()
}
