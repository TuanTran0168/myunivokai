package httpx

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
)

type ErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId,omitempty"`
}

type ErrorEnvelope struct {
	Error ErrorBody `json:"error"`
}

func WriteJSON(responseWriter http.ResponseWriter, status int, value any) {
	payload, err := json.Marshal(value)
	if err != nil {
		log.Error().Err(err).Msg("marshal json response")
		responseWriter.Header().Set("Content-Type", "application/json")
		responseWriter.WriteHeader(http.StatusInternalServerError)
		_, _ = responseWriter.Write([]byte(`{"error":{"code":"INTERNAL_ERROR","message":"Something went wrong."}}`))
		return
	}
	responseWriter.Header().Set("Content-Type", "application/json")
	responseWriter.Header().Set("Content-Length", strconv.Itoa(len(payload)))
	responseWriter.WriteHeader(status)
	_, _ = responseWriter.Write(payload)
}

func WriteError(responseWriter http.ResponseWriter, request *http.Request, status int, code, message string) {
	WriteJSON(responseWriter, status, ErrorEnvelope{Error: ErrorBody{
		Code:      code,
		Message:   message,
		RequestID: RequestID(request.Context()),
	}})
}
