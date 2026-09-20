// What the rider says about a ride, as opposed to what the trainer recorded
// (#2328). Two rides with the same average watts can feel nothing alike, and
// six weeks later the numbers cannot tell the rider which was which.
//
// The scale is not invented here: docs/SPEC.md "How a ride felt" fixes the
// Borg CR10 session rating at integers 1-10 with its published anchors, and
// the note at 500 characters. Both bounds are declared once in `protocol`
// and generated into the web app with the message types (#2122), so the
// picker cannot draw a button this handler would refuse.
//
// ADR-0055 is the privacy half: the note is served by this package's
// owner-scoped reads and by the account export, and by nothing else. There is
// no sharing switch that carries it.
package rides

import (
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// handleFeel writes both halves at once, because they are one thing a rider
// fills in once: a PUT that replaces the pair. Sending null for either clears
// it — un-rating a ride and deleting a note are things riders do, and neither
// deserves a second endpoint.
//
// It stands beside PATCH /api/rides/{id} rather than inside it for
// handleFtpAfter's reason: sharing is a rider's decision about who sees a
// ride, this is the rider's account of riding it. A cookie is required, not a
// personal token — bearer auth is GET-only (ADR-0017), and RequireUser holds
// the Origin check for every mutating verb (#678).
func (s *Service) handleFeel(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a ride id.")
		return
	}
	var body struct {
		RPE  *int16  `json:"rpe"`
		Note *string `json:"note"`
	}
	if err := httpx.DecodeStrict(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"That request could not be read. Send rpe as 1-10 or null, and note as text or null.")
		return
	}
	if body.RPE != nil && (*body.RPE < protocol.MinRPE || *body.RPE > protocol.MaxRPE) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			fmt.Sprintf("How hard it felt is %d to %d, or nothing at all.", protocol.MinRPE, protocol.MaxRPE), "rpe")
		return
	}
	note := trimNote(body.Note)
	if note != nil && utf8.RuneCountInString(*note) > protocol.MaxRideNoteChars {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			fmt.Sprintf("A note is up to %d characters — this one is %d. Shorten it and save again.",
				protocol.MaxRideNoteChars, utf8.RuneCountInString(*note)), "note")
		return
	}
	n, err := s.store.Queries.SetRideFeel(r.Context(), db.SetRideFeelParams{
		Rpe: body.RPE, Note: note, ID: id, UserID: user.ID,
	})
	if err != nil {
		httpx.Fail(w, s.log, "ride feel failed", err, "That could not be saved. Try again.")
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That ride is not one of yours.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, feelJSON{RPE: body.RPE, Note: note})
}

// feelJSON is the pair, on the ride's own page and in this endpoint's answer.
// Both nil is a ride the rider has not said anything about, which is most of
// them; `omitempty` on a pointer would make "no rating" and "field missing"
// the same shape to a client that has to tell them apart.
type feelJSON struct {
	// docs/SPEC.md's 1-10, or null.
	RPE *int16 `json:"rpe"`
	// The rider's own sentence, or null. Never leaves an owner-scoped read
	// (ADR-0055).
	Note *string `json:"note"`
}

// trimNote turns what the rider typed into what is stored: an empty note is
// no note (docs/SPEC.md), so a box cleared to spaces erases the column rather
// than storing whitespace that reads as a note on every later page.
func trimNote(raw *string) *string {
	if raw == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*raw)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
