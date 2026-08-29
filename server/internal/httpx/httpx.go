// Package httpx is the one home of the API error shape from
// .claude/rules/errors.md. Extracted when auth became its second consumer.
package httpx

import (
	"encoding/json"
	"net/http"
)

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func WriteError(w http.ResponseWriter, status int, code, message string) {
	writeJSONError(w, status, ErrorResponse{Error: code, Message: message})
}

// WriteFieldError is the form-validation variant: the field name lets the
// client render the message inline under the input.
func WriteFieldError(w http.ResponseWriter, status int, code, message, field string) {
	writeJSONError(w, status, ErrorResponse{Error: code, Message: message, Field: field})
}

func writeJSONError(w http.ResponseWriter, status int, body ErrorResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// WriteJSON is the success-side counterpart, so handlers do not each grow
// their own three lines of encoder boilerplate.
func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// DecodeStrict reads a JSON body the way every handler should: bounded,
// unknown fields refused.
func DecodeStrict(r *http.Request, into any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 64<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(into)
}
