package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

// AdminAccountsHandler relays account:read/account:manage routes straight to
// auth-service — the gateway performs no summation or transformation of its
// own, same as every other admin-record route in this package.
type AdminAccountsHandler struct {
	transport *RPCTransport
}

func NewAdminAccountsHandler(transport *RPCTransport) *AdminAccountsHandler {
	return &AdminAccountsHandler{transport: transport}
}

func (handler *AdminAccountsHandler) List(responseWriter http.ResponseWriter, request *http.Request) {
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAccountListQuerySubject, pageQueryFromRequest(request))
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *AdminAccountsHandler) Get(responseWriter http.ResponseWriter, request *http.Request) {
	accountID := chi.URLParam(request, "accountID")
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAccountGetQuerySubject, contracts.AccountGetQueryData{AccountID: accountID})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

// Invite is the one account:manage route with no email infrastructure
// behind it yet: the raw invite token is returned to the caller (a staff
// member with account:manage) to relay out of band. See
// contracts.InviteCreateResponseData.
func (handler *AdminAccountsHandler) Invite(responseWriter http.ResponseWriter, request *http.Request) {
	var body struct {
		Email   string   `json:"email"`
		RoleIDs []string `json:"roleIds"`
	}
	if !decodeJSONBody(responseWriter, request, &body) {
		return
	}
	claims, _ := middleware.AdminClaims(request.Context())
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthInviteCreateQuerySubject, contracts.InviteCreateData{
		Email: body.Email, RoleIDs: body.RoleIDs, ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context()),
	})
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *AdminAccountsHandler) Disable(responseWriter http.ResponseWriter, request *http.Request) {
	accountID := chi.URLParam(request, "accountID")
	claims, _ := middleware.AdminClaims(request.Context())
	data := contracts.AccountDisableData{AccountID: accountID, ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context())}
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAccountDisableQuerySubject, data)
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func (handler *AdminAccountsHandler) Enable(responseWriter http.ResponseWriter, request *http.Request) {
	accountID := chi.URLParam(request, "accountID")
	claims, _ := middleware.AdminClaims(request.Context())
	data := contracts.AccountEnableData{AccountID: accountID, ActorAccountID: claims.Subject, SourceAddress: httpx.ClientIP(request.Context())}
	response, ok := handler.transport.Request(responseWriter, request, contracts.AuthAccountEnableQuerySubject, data)
	if !ok {
		return
	}
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

func pageQueryFromRequest(request *http.Request) contracts.PageQueryData {
	pageSize, _ := strconv.Atoi(request.URL.Query().Get("pageSize"))
	return contracts.PageQueryData{Cursor: request.URL.Query().Get("cursor"), PageSize: pageSize}
}

func decodeJSONBody(responseWriter http.ResponseWriter, request *http.Request, target any) bool {
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "INVALID_JSON", "The request body must be valid JSON.")
		return false
	}
	return true
}
