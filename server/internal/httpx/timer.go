package httpx

import (
	"net/http"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// BadTimer answers 400 unless seconds is no timer (0) or one a sender may set
// on a temporary message (#2644) — the check the channel and DM doors share,
// so the two cannot come to offer different timers.
func BadTimer(w http.ResponseWriter, seconds int) bool {
	if seconds == 0 || protocol.IsTemporaryTimer(seconds) {
		return false
	}
	WriteFieldError(w, http.StatusBadRequest, "validation_error",
		"A temporary message lasts 1 hour, 24 hours or 7 days.", "expiresIn")
	return true
}
