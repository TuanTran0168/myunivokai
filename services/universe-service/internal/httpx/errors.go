package httpx

import (
	"encoding/json"
	"net/http"
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
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func WriteError(w http.ResponseWriter, r *http.Request, status int, code, message string, details []ErrorDetail) {
	WriteJSON(w, status, ErrorEnvelope{Error: ErrorBody{
		Code:      code,
		Message:   message,
		Details:   details,
		RequestID: RequestID(r.Context()),
	}})
}
