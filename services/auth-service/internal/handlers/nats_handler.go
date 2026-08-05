package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/services"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const invalidRequestJobID = "invalid-request"

type AuthService interface {
	Login(ctx context.Context, data contracts.LoginData, sourceAddress string) (contracts.LoginResponseData, error)
	Refresh(ctx context.Context, rawRefreshToken, sourceAddress string) (contracts.LoginResponseData, error)
	Logout(ctx context.Context, rawRefreshToken, sourceAddress string) error
	TokenVersion(ctx context.Context, accountID string) (int, error)
	DisableAccount(ctx context.Context, accountID, actorAccountID, sourceAddress string) error
	EnableAccount(ctx context.Context, accountID, actorAccountID, sourceAddress string) error
}

type ResponsePublisher interface {
	Publish(string, []byte) error
}

// NATSHandler owns auth-service's transport-specific request handling. Its
// query surface is deliberately narrower than the subjects contracts/go
// already declares: account/role/permission/audit list and role
// create/update/delete/assign/revoke are frozen wire format for later
// phases (admin records, hardening), not implemented here.
type NATSHandler struct {
	authService       AuthService
	responsePublisher ResponsePublisher
	queryTimeout      time.Duration
}

func NewNATSHandler(authService AuthService, responsePublisher ResponsePublisher, queryTimeout time.Duration) *NATSHandler {
	return &NATSHandler{authService: authService, responsePublisher: responsePublisher, queryTimeout: queryTimeout}
}

func (handler *NATSHandler) HandleLoginQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.LoginData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.LoginResponseData, error) {
		return handler.authService.Login(ctx, envelope.Data, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleRefreshQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.RefreshData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.LoginResponseData, error) {
		return handler.authService.Refresh(ctx, envelope.Data.RefreshToken, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleLogoutQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.LogoutData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	_, err := withQueryTimeout(handler, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, handler.authService.Logout(ctx, envelope.Data.RefreshToken, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusNoContent, struct{}{}, err)
}

func (handler *NATSHandler) HandleTokenVersionQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.TokenVersionQueryData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	response, err := withQueryTimeout(handler, func(ctx context.Context) (contracts.TokenVersionResponseData, error) {
		tokenVersion, err := handler.authService.TokenVersion(ctx, envelope.Data.AccountID)
		return contracts.TokenVersionResponseData{TokenVersion: tokenVersion}, err
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, response, err)
}

func (handler *NATSHandler) HandleAccountDisableQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AccountDisableData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	_, err := withQueryTimeout(handler, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, handler.authService.DisableAccount(ctx, envelope.Data.AccountID, envelope.Data.ActorAccountID, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, struct{}{}, err)
}

func (handler *NATSHandler) HandleAccountEnableQuery(message *nats.Msg) {
	var envelope contracts.Envelope[contracts.AccountEnableData]
	if !decodeQuery(handler, message, &envelope) {
		return
	}
	_, err := withQueryTimeout(handler, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, handler.authService.EnableAccount(ctx, envelope.Data.AccountID, envelope.Data.ActorAccountID, envelope.Data.SourceAddress)
	})
	handler.respondWithResult(message, envelope.JobID, http.StatusOK, struct{}{}, err)
}

func decodeEnvelope[DataType any](payload []byte, envelope *contracts.Envelope[DataType]) error {
	if err := json.Unmarshal(payload, envelope); err != nil {
		return err
	}
	return envelope.Validate()
}

func decodeQuery[DataType any](handler *NATSHandler, message *nats.Msg, envelope *contracts.Envelope[DataType]) bool {
	if strings.TrimSpace(message.Reply) == "" {
		return false
	}
	if err := decodeEnvelope(message.Data, envelope); err != nil {
		handler.respond(message, contracts.ErrorRPCEnvelope(invalidRequestJobID, http.StatusBadRequest, "INVALID_REQUEST", "The internal request is invalid."))
		return false
	}
	return true
}

func withQueryTimeout[ResponseType any](handler *NATSHandler, query func(context.Context) (ResponseType, error)) (ResponseType, error) {
	queryContext, cancel := context.WithTimeout(context.Background(), handler.queryTimeout)
	defer cancel()
	return query(queryContext)
}

func (handler *NATSHandler) respondWithResult(message *nats.Msg, jobID string, successStatus int, payload any, err error) {
	switch {
	case errors.Is(err, repositories.ErrNotFound):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found."))
	case errors.Is(err, services.ErrInvalidCredentials):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Incorrect email or password."))
	case errors.Is(err, services.ErrAccountDisabled):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusForbidden, "ACCOUNT_DISABLED", "This account has been disabled."))
	case errors.Is(err, services.ErrAccountLocked):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusForbidden, "ACCOUNT_LOCKED", "This account is temporarily locked. Try again later."))
	case errors.Is(err, services.ErrInvalidRefreshToken):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusUnauthorized, "INVALID_REFRESH_TOKEN", "The session is no longer valid. Please log in again."))
	case errors.Is(err, services.ErrLastSuperAdmin):
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusConflict, "LAST_SUPER_ADMIN", "The last super admin account cannot be disabled."))
	case err != nil:
		log.Error().Err(err).Str("request_id", jobID).Msg("auth query failed")
		handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The request could not be completed."))
	default:
		responseEnvelope, marshalError := contracts.SuccessRPCEnvelope(jobID, successStatus, payload)
		if marshalError != nil {
			handler.respond(message, contracts.ErrorRPCEnvelope(jobID, http.StatusInternalServerError, "INTERNAL_ERROR", "The response could not be created."))
			return
		}
		handler.respond(message, responseEnvelope)
	}
}

func (handler *NATSHandler) respond(message *nats.Msg, response any) {
	payload, err := json.Marshal(response)
	if err != nil {
		log.Error().Err(err).Msg("marshal auth NATS response")
		return
	}
	if err := handler.responsePublisher.Publish(message.Reply, payload); err != nil {
		log.Error().Err(err).Msg("publish auth NATS response")
	}
}
