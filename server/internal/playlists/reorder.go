package playlists

import (
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// moveTrack puts one saved entry at a new index (#1428) — the queue's "move",
// on the shelf: the index is clamped the way jukebox_actions clamps, and the
// rest keeps its order. Every row is renumbered in one transaction, so a
// playlist never reads with a gap or a duplicate position.
// ponytail: O(n) updates per move, n ≤ maxSavedTracks; a single-statement
// renumber if somebody drags through a 300-track list all evening.
func (s *Service) moveTrack(w http.ResponseWriter, r *http.Request, sc scope) {
	p, ok := s.ownedPlaylist(w, r, sc)
	if !ok {
		return
	}
	trackID, err := store.ParseUUID(r.PathValue("trackID"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That track does not exist.")
		return
	}
	var req struct {
		Index int `json:"index"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	rows, err := s.store.Queries.ListPlaylistTracks(r.Context(), p.ID)
	if err != nil {
		s.log.Error("list playlist tracks failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The playlist could not be loaded.")
		return
	}
	from := -1
	for i, row := range rows {
		if row.ID == trackID {
			from = i
		}
	}
	if from < 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That track does not exist.")
		return
	}
	to := max(0, min(req.Index, len(rows)-1))
	if to != from {
		moved := rows[from]
		rows = append(rows[:from], rows[from+1:]...)
		rows = append(rows[:to], append([]db.ListPlaylistTracksRow{moved}, rows[to:]...)...)
	}

	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.log.Error("reorder: begin failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The playlist could not be reordered. Try again.")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	if err := q.ShiftPlaylistPositions(r.Context(), p.ID); err != nil {
		s.log.Error("reorder: shift failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The playlist could not be reordered. Try again.")
		return
	}
	for i, row := range rows {
		if err := q.SetPlaylistTrackPosition(r.Context(), db.SetPlaylistTrackPositionParams{
			ID: row.ID, PlaylistID: p.ID, Position: int32(i), //nolint:gosec // bounded by maxSavedTracks
		}); err != nil {
			s.log.Error("reorder: set position failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The playlist could not be reordered. Try again.")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.log.Error("reorder: commit failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The playlist could not be reordered. Try again.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleMoveRoomTrack(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.roomScope(w, r); ok {
		s.moveTrack(w, r, sc)
	}
}

func (s *Service) handleMovePersonalTrack(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.personalScope(w, r); ok {
		s.moveTrack(w, r, sc)
	}
}
