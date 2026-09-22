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

// handleQueueTracksIntoChannel is the Music page's multi-select onto a voice
// channel's deck (#1433, #2439), for anyone who may enter it.
func (s *Service) handleQueueTracksIntoChannel(w http.ResponseWriter, r *http.Request) {
	channel, user, _, ok := s.channels.RequireVoice(w, r)
	if !ok {
		return
	}
	s.queueTracks(w, r, store.UUIDString(channel.ID), user)
}

// queueTracks goes through the same bridge a saved playlist takes rather
// than N socket commands, because the hub throttles a rider's commands to
// one per 300 ms and drops the rest — fifty clicks' worth of adds would
// arrive as three. Tracks that are not the caller's own are absent, not
// forbidden (#1095): they are counted as skipped and the rest go on.
func (s *Service) queueTracks(w http.ResponseWriter, r *http.Request, channel string, user db.User) {
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
		// Bpm travels with the track (#1511): playlist replay, history and
		// smart shuffle all carry it, and this bridge did not — so a track
		// queued from the Music page reached the deck untagged and the
		// block-cadence match (#1431) never fired for it. Nil is a track
		// nobody has tagged, which is a 0 on the wire, not a zero tempo.
		bpm := 0
		if track.Bpm != nil {
			bpm = int(*track.Bpm)
		}
		cmds = append(cmds, protocol.JukeboxCommand{
			Action: "add", TrackID: store.UUIDString(track.ID), Title: track.Title, Artist: track.Artist,
			Bpm: bpm, DurationMs: int(track.DurationMs),
		})
	}
	added, ok := s.queueOnto(w, channel, user, cmds)
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"queued": added, "skipped": skipped})
}
