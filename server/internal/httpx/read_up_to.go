package httpx

import (
	"errors"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
)

// ReadUpTo is a read's optional `{"upTo": "<line id>"}` body (#2750, #2755):
// the newest line the reader was shown, which the read covers and nothing
// after it. No body gives the zero id — a tab still on the script from
// before — which the read queries take as the newest line. When ok is false
// the refusal is already written.
func ReadUpTo(w http.ResponseWriter, r *http.Request) (upTo pgtype.UUID, ok bool) {
	var req struct {
		UpTo string `json:"upTo"`
	}
	if err := DecodeStrict(r, &req); err != nil && !errors.Is(err, io.EOF) {
		WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return upTo, false
	}
	if req.UpTo == "" {
		return upTo, true
	}
	upTo, err := store.ParseUUID(req.UpTo)
	if err != nil {
		WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a message here.", "upTo")
		return pgtype.UUID{}, false
	}
	return upTo, true
}
