// Package httpx is the one home of the API error shape from
// .claude/rules/errors.md. Extracted when auth became its second consumer.
package httpx

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
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
	// Every JSON answer is a rider's, or as good as (#1736): the calendar
	// feed's reasoning (RFC 9111 §4.2.2, #1701) applies to /api/me and
	// /api/rides/{id} just the same, and self-hosters put proxies in front.
	w.Header().Set("Cache-Control", "private, no-store")
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

// MaxImageBytes caps one pasted image (#279, #285). The client compresses to
// WebP well under this — the cap is the trust boundary, not the target.
const MaxImageBytes = 2 << 20

// ReadImageUpload is the one trust boundary for a pasted image, shared by room
// chat and DMs: bounded read, type sniffed from the bytes rather than believed
// from a header, and only the four types the chat surfaces render. On refusal
// it writes the error and reports false — the caller just returns.
func ReadImageUpload(w http.ResponseWriter, r *http.Request) (data []byte, mime string, ok bool) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxImageBytes))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "validation_error", "Images are capped at 2 MB.")
		return nil, "", false
	}
	switch mime = http.DetectContentType(data); mime {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
		return data, mime, true
	}
	WriteError(w, http.StatusBadRequest, "validation_error", "Only PNG, JPEG, WebP, or GIF images can be sent.")
	return nil, "", false
}

// ServeImage writes a stored upload back out. The URL is stable and the bytes
// may change, so the ETag is the set time and the browser revalidates — a 304
// costs one round trip, and a re-upload shows at once everywhere. Rider-
// supplied bytes from the app's own origin are never re-interpreted as HTML,
// whatever passed the sniff.
// ServeImmutableImage serves rider-supplied bytes that never change under
// their id — a chat or DM picture — so the browser may keep them forever.
// One trust boundary for all three image routes (#1416): nosniff, because a
// polyglot that passed the upload sniff must never be re-read as HTML.
func ServeImmutableImage(w http.ResponseWriter, mime string, data []byte) {
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	_, _ = w.Write(data)
}

func ServeImage(w http.ResponseWriter, r *http.Request, mime string, data []byte, setAt time.Time) {
	etag := fmt.Sprintf(`"%d"`, setAt.UnixMilli())
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	_, _ = w.Write(data)
}

// Fail is the one shape for "something on our side broke" (#1695): the
// internal detail goes to the log with its context keys, the rider gets a
// curated sentence and a 500 — never err.Error() (errors.md). It stood
// written out 207 times before it had a name.
func Fail(w http.ResponseWriter, log *slog.Logger, what string, err error, message string, kv ...any) {
	log.Error(what, append([]any{"err", err}, kv...)...)
	WriteError(w, http.StatusInternalServerError, "internal_error", message)
}
