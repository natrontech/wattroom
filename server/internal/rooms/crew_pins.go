// The crew's pin board (ADR-0056, #2405): the handful of facts a crew keeps
// needing that nothing else holds. Owned by the crew and read in every room
// of it — the place that draws it is a room's, but the board is not.
//
// Everyone in the crew writes. There is no `administers` call in this file
// and that is the decision, not an omission: the ADR's line is that a crew is
// a group of friends, a pin is two fields, and undo covers a mistake. Nothing
// asks who wrote a pin either, so nothing here reads created_by for anything
// but showing a name.
package rooms

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type pinJSON struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
	// Who wrote it, for the card's byline. Empty when that account is gone —
	// the pin outlives its author (the migration's SET NULL).
	CreatedBy string `json:"createdBy,omitempty"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func (s *Service) registerPins(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/crews/{id}/pins", s.handleListPins)
	mux.HandleFunc("POST /api/crews/{id}/pins", s.handleCreatePin)
	mux.HandleFunc("PATCH /api/crews/{id}/pins/{pinID}", s.handleUpdatePin)
	mux.HandleFunc("DELETE /api/crews/{id}/pins/{pinID}", s.handleDeletePin)
}

func (s *Service) handleListPins(w http.ResponseWriter, r *http.Request) {
	crew, _, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListCrewPins(r.Context(), crew.ID)
	if err != nil {
		httpx.Fail(w, s.log, "pins list failed", err, "The board could not be loaded.", "crew", store.UUIDString(crew.ID))
		return
	}
	// A JSON array, never null: a board with nothing on it is an empty list,
	// and the client's four states (errors.md) tell empty from failed by the
	// shape rather than by guessing.
	out := make([]pinJSON, 0, len(rows))
	for _, row := range rows {
		pin := pinJSON{
			ID:        store.UUIDString(row.ID),
			Title:     row.Title,
			Body:      row.Body,
			CreatedAt: row.CreatedAt.Time.Format(time.RFC3339),
			UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339),
		}
		if row.CreatedByName != nil {
			pin.CreatedBy = *row.CreatedByName
		}
		out = append(out, pin)
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// pinBody validates the two fields both write paths share. The bounds are
// protocol's, counted in RUNES — a board pinned in Japanese gets the same
// forty characters as one pinned in English (#1986).
func pinBody(w http.ResponseWriter, r *http.Request) (title, body string, ok bool) {
	var req struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return "", "", false
	}
	title = strings.TrimSpace(req.Title)
	body = strings.TrimSpace(req.Body)
	if title == "" || utf8.RuneCountInString(title) > protocol.MaxPinTitleChars {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A pin's title has to be 1–40 characters.", "title")
		return "", "", false
	}
	if body == "" || utf8.RuneCountInString(body) > protocol.MaxPinBodyChars {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A pin has to say something, in 1000 characters or less.", "body")
		return "", "", false
	}
	return title, body, true
}

func (s *Service) handleCreatePin(w http.ResponseWriter, r *http.Request) {
	crew, user, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	title, body, ok := pinBody(w, r)
	if !ok {
		return
	}
	row, err := s.store.Queries.CreateCrewPin(r.Context(), db.CreateCrewPinParams{
		CrewID: crew.ID, Title: title, Body: body, CreatedBy: user.ID,
		MaxPins: protocol.MaxCrewPins,
	})
	if err != nil {
		// No row is the cap, not a fault: the statement counts and inserts
		// together, so a full board returns nothing rather than erroring.
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusConflict, "conflict",
				"This crew's board is full at 20 pins. Unpin one to make room.")
			return
		}
		httpx.Fail(w, s.log, "pin create failed", err, "The pin could not be saved.", "crew", store.UUIDString(crew.ID))
		return
	}
	s.changed()
	httpx.WriteJSON(w, http.StatusCreated, pinJSON{
		ID: store.UUIDString(row.ID), Title: title, Body: body,
		CreatedBy: user.DisplayName,
		CreatedAt: row.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339),
	})
}

func (s *Service) handleUpdatePin(w http.ResponseWriter, r *http.Request) {
	crew, _, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("pinID"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That pin is not on this board.")
		return
	}
	title, body, ok := pinBody(w, r)
	if !ok {
		return
	}
	row, err := s.store.Queries.UpdateCrewPin(r.Context(), db.UpdateCrewPinParams{
		ID: id, CrewID: crew.ID, Title: title, Body: body,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "not_found", "That pin is not on this board.")
			return
		}
		httpx.Fail(w, s.log, "pin update failed", err, "The pin could not be saved.", "crew", store.UUIDString(crew.ID))
		return
	}
	s.changed()
	httpx.WriteJSON(w, http.StatusOK, pinJSON{
		ID: store.UUIDString(row.ID), Title: title, Body: body,
		CreatedAt: row.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339),
	})
}

func (s *Service) handleDeletePin(w http.ResponseWriter, r *http.Request) {
	crew, _, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("pinID"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That pin is not on this board.")
		return
	}
	rows, err := s.store.Queries.DeleteCrewPin(r.Context(), db.DeleteCrewPinParams{ID: id, CrewID: crew.ID})
	if err != nil {
		httpx.Fail(w, s.log, "pin delete failed", err, "The pin could not be unpinned.", "crew", store.UUIDString(crew.ID))
		return
	}
	if rows == 0 {
		// Not a silent success: the undo toast the client raises promises the
		// pin came off, and a 204 for a pin that was never there would make
		// that promise about nothing.
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That pin is not on this board.")
		return
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
