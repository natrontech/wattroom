package playlists

import (
	"context"
	"math/rand/v2"
	"net/http"
	"strings"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type autoplayJSON struct {
	Enabled          bool   `json:"enabled"`
	Order            string `json:"order"` // "ordered" | "shuffled"
	FixedVideoID     string `json:"fixedVideoId,omitempty"`
	FixedVideoTitle  string `json:"fixedVideoTitle,omitempty"`
	ActivePlaylistID string `json:"activePlaylistId,omitempty"`
}

func autoplayJSONFrom(room db.Room) autoplayJSON {
	out := autoplayJSON{
		Enabled: room.AutoplayEnabled, Order: room.AutoplayOrder,
		FixedVideoID: room.AutoplayFixedVideoID, FixedVideoTitle: room.AutoplayFixedVideoTitle,
	}
	if room.AutoplayPlaylistID.Valid {
		out.ActivePlaylistID = store.UUIDString(room.AutoplayPlaylistID)
	}
	return out
}

func (s *Service) handleGetAutoplay(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.roomScope(w, r)
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, autoplayJSONFrom(sc.room))
}

// handleUpdateAutoplay always replaces the whole setting (like UpdateRoom) —
// the settings panel PATCHes on every change with its full local state, the
// same pattern the room settings page already uses for sound pack/icon.
func (s *Service) handleUpdateAutoplay(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.roomModeratorScope(w, r)
	if !ok {
		return
	}
	var req autoplayJSON
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if req.Order != "ordered" && req.Order != "shuffled" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Autoplay order is either ordered or shuffled.", "order")
		return
	}
	fixedID := strings.TrimSpace(req.FixedVideoID)
	fixedTitle := clip(strings.TrimSpace(req.FixedVideoTitle), 200)
	if fixedID == "" {
		fixedTitle = ""
	} else if !hub.ValidVideoID(fixedID) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a video this jukebox can play.", "fixedVideoId")
		return
	}
	if _, err := s.store.Queries.UpdateAutoplay(r.Context(), db.UpdateAutoplayParams{
		ID: sc.room.ID, AutoplayEnabled: req.Enabled, AutoplayOrder: req.Order,
		AutoplayFixedVideoID: fixedID, AutoplayFixedVideoTitle: fixedTitle,
	}); err != nil {
		s.log.Error("update autoplay failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Autoplay could not be saved. Try again.")
		return
	}
	if activeID := strings.TrimSpace(req.ActivePlaylistID); activeID == "" {
		if err := s.store.Queries.ClearActivePlaylist(r.Context(), sc.room.ID); err != nil {
			s.log.Error("clear active playlist failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Autoplay could not be saved. Try again.")
			return
		}
	} else {
		id, err := store.ParseUUID(activeID)
		if err != nil {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That playlist does not exist.", "activePlaylistId")
			return
		}
		rows, err := s.store.Queries.SetActivePlaylist(r.Context(), db.SetActivePlaylistParams{ID: sc.room.ID, AutoplayPlaylistID: id})
		if err != nil {
			s.log.Error("set active playlist failed", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Autoplay could not be saved. Try again.")
			return
		}
		if rows == 0 {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That playlist is not one of this room's own.", "activePlaylistId")
			return
		}
	}
	room, err := s.store.Queries.GetRoomBySlug(r.Context(), sc.room.Slug)
	if err != nil {
		s.log.Error("room reload failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Autoplay was saved but could not be reloaded.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, autoplayJSONFrom(room))
}

// Autoplay implements hub.AutoplaySource (#627): read once per join-onto-an-
// idle-deck, entirely outside any room lock. fixed, when the room has a
// pinned starter, always leads; tracks is the active playlist in list order,
// or freshly shuffled when that's the room's current setting — "shuffled"
// means shuffled once per trigger, not a smart/history-weighted order (#269
// is that feature, and a different one).
func (s *Service) Autoplay(ctx context.Context, slug string) (fixed *protocol.JukeboxCommand, tracks []protocol.JukeboxCommand, ok bool) {
	room, err := s.store.Queries.GetRoomBySlug(ctx, slug)
	if err != nil || !room.AutoplayEnabled {
		return nil, nil, false
	}
	if room.AutoplayFixedVideoID != "" && hub.ValidVideoID(room.AutoplayFixedVideoID) {
		cmd := protocol.JukeboxCommand{Action: "add", VideoID: room.AutoplayFixedVideoID, Title: room.AutoplayFixedVideoTitle}
		fixed = &cmd
	}
	if room.AutoplayPlaylistID.Valid {
		if rows, err := s.store.Queries.ListPlaylistTracks(ctx, room.AutoplayPlaylistID); err == nil {
			tracks = commandsFromTracks(rows)
			if room.AutoplayOrder == "shuffled" {
				// A party-playlist shuffle, not a security control — crypto/rand
				// would cost a syscall per swap for no one keeping score.
				rand.Shuffle(len(tracks), func(i, j int) { tracks[i], tracks[j] = tracks[j], tracks[i] }) //nolint:gosec
			}
		}
	}
	if fixed == nil && len(tracks) == 0 {
		return nil, nil, false
	}
	return fixed, tracks, true
}
