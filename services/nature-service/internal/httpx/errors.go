package httpx

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
)

type ErrorDetail struct {
	Field   string `json:"field,omitempty"`
	Message string `json:"message"`
}

type ErrorBody struct {
	Code      string        `json:"code"`
	Message   string        `json:"message"`
	Details   []ErrorDetail `json:"details,omitempty"`
	RequestID string        `json:"requestId,omitempty"`
}

type ErrorEnvelope struct {
	Error ErrorBody `json:"error"`
}

func WriteJSON(w http.ResponseWriter, status int, value any) {
	// Marshal before committing the status header: a serialization failure can
	// still become a clean 500 instead of a truncated 200 body, and the whole
	// payload goes out in one buffered write instead of many small ones.
	payload, err := json.Marshal(value)
	if err != nil {
		log.Error().Err(err).Msg("marshal json response")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"code":"INTERNAL_ERROR","message":"Something went wrong."}}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}

func WriteError(w http.ResponseWriter, r *http.Request, status int, code, message string, details []ErrorDetail) {
	WriteJSON(w, status, ErrorEnvelope{Error: ErrorBody{
		Code:      code,
		Message:   message,
		Details:   details,
		RequestID: RequestID(r.Context()),
	}})
}
