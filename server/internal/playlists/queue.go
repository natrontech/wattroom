package playlists

import (
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// maxQueuedAtOnce bounds one "queue these" request to the live queue's own
// entry cap (hub.maxQueue) — anything past it could never land anyway.
const maxQueuedAtOnce = 50

// handleQueueTracks puts several of the caller's library tracks on the
// room's live queue in one go (#1433): the Music page's multi-select. It
// goes through the same bridge a saved playlist takes rather than N socket
// commands, because the hub throttles a rider's commands to one per 300 ms
// and drops the rest — fifty clicks' worth of adds would arrive as three.
// Tracks that are not the caller's own are absent, not forbidden (#1095):
// they are counted as skipped and the rest go on.
func (s *Service) handleQueueTracks(w http.ResponseWriter, r *http.Request) {
	room, user, ok := s.queueScope(w, r)
	if !ok {
		return
	}
	var req struct {
		TrackIDs []string `json:"trackIds"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if len(req.TrackIDs) == 0 || len(req.TrackIDs) > maxQueuedAtOnce {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Pick between one and fifty tracks.", "trackIds")
		return
	}
	cmds := make([]protocol.JukeboxCommand, 0, len(req.TrackIDs))
	skipped := 0
	for _, raw := range req.TrackIDs {
		id, err := store.ParseUUID(raw)
		if err != nil {
			skipped++
			continue
		}
		track, err := s.store.Queries.GetTrack(r.Context(), db.GetTrackParams{ID: id, UploadedBy: user.ID})
		if err != nil {
			skipped++
			continue
		}
		cmds = append(cmds, protocol.JukeboxCommand{
			Action: "add", TrackID: store.UUIDString(track.ID), Title: track.Title, Artist: track.Artist,
			DurationMs: int(track.DurationMs),
		})
	}
	if s.live == nil {
		httpx.WriteError(w, http.StatusConflict, "conflict", "Open the room to queue into its jukebox.")
		return
	}
	added, live := s.live.QueuePlaylist(room.Slug, store.UUIDString(user.ID), user.DisplayName, cmds)
	if !live {
		httpx.WriteError(w, http.StatusConflict, "conflict", "Open the room to queue into its jukebox.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"queued": added, "skipped": skipped})
}
