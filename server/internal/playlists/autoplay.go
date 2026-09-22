package playlists

import (
	"context"
	"errors"
	"math/rand/v2"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The fixed start — one pinned video that played before the playlist — is
// gone (#1422, the 95 % rule): the columns stay one release for the rollback
// path (ADR-0019) and #1430 drops them.
type autoplayJSON struct {
	Enabled          bool   `json:"enabled"`
	Order            string `json:"order"` // "ordered" | "shuffled" | "smart"
	ActivePlaylistID string `json:"activePlaylistId,omitempty"`
}

func autoplayJSONFrom(room db.Room) autoplayJSON {
	out := autoplayJSON{Enabled: room.AutoplayEnabled, Order: room.AutoplayOrder}
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
	if !validAutoplayOrder(req.Order) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Autoplay order is ordered, shuffled, or smart.", "order")
		return
	}
	// One statement, so a refusal changes nothing (#2248): the switch, the
	// order and the active playlist used to be three writes, and a playlist
	// that was not this room's was refused after the first two had committed.
	var active pgtype.UUID
	if activeID := strings.TrimSpace(req.ActivePlaylistID); activeID != "" {
		id, err := store.ParseUUID(activeID)
		if err != nil {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That playlist does not exist.", "activePlaylistId")
			return
		}
		active = id
	}
	room, err := s.store.Queries.SetAutoplay(r.Context(), db.SetAutoplayParams{
		ID: sc.room.ID, AutoplayEnabled: req.Enabled, AutoplayOrder: req.Order, AutoplayPlaylistID: active,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// The room was read this request, so the ownership clause is what
		// declined it — unless the room itself has just been deleted.
		if !active.Valid {
			httpx.WriteError(w, http.StatusNotFound, "not_found", "That room is gone.")
			return
		}
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That playlist is not one of this room's own.", "activePlaylistId")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "save autoplay failed", err, "Autoplay could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, autoplayJSONFrom(room))
}

// validAutoplayOrder: the three orders autoplay walks the active playlist in
// (#1429). "ordered" and "shuffled" take every entry; "smart" (#269) takes
// the list's library tracks weighted by this room's play/skip history, and
// the members' whole libraries when the list holds none. One setting: a
// room picks an order, and the source is always its playlist.
func validAutoplayOrder(order string) bool {
	return order == "ordered" || order == "shuffled" || order == "smart"
}

// Autoplay implements hub.AutoplaySource (#627): read once per join-onto-an-
// idle-deck, entirely outside any room lock. One source, three orders
// (#1429): the active playlist, walked in list order, freshly shuffled once
// per trigger, or — "smart" (#269) — its library tracks drawn by this
// room's history, weighted since #270 toward the cadence `mood` says the
// room is turning right now. Smart with no active playlist, or one holding
// no library track, draws from the members' whole libraries instead.
func (s *Service) Autoplay(ctx context.Context, channel string, mood hub.SessionMood) (tracks []protocol.JukeboxCommand, ok bool) {
	room, err := s.store.RoomOfVoiceChannel(ctx, channel)
	if err != nil || !room.AutoplayEnabled {
		return nil, false
	}
	var rows []db.ListPlaylistTracksRow
	if room.AutoplayPlaylistID.Valid {
		if rows, err = s.store.Queries.ListPlaylistTracks(ctx, room.AutoplayPlaylistID); err != nil {
			s.log.Error("autoplay: list playlist tracks failed", "channel", channel, "err", err)
			return nil, false
		}
	}
	switch room.AutoplayOrder {
	case "smart":
		var only []pgtype.UUID
		for _, row := range rows {
			if row.TrackID.Valid {
				only = append(only, row.TrackID)
			}
		}
		tracks = s.smartShuffle(ctx, room.ID, channel, mood, only)
	case "shuffled":
		tracks = commandsFromTracks(rows)
		// A party-playlist shuffle, not a security control — crypto/rand
		// would cost a syscall per swap for no one keeping score.
		rand.Shuffle(len(tracks), func(i, j int) { tracks[i], tracks[j] = tracks[j], tracks[i] }) //nolint:gosec
	default:
		tracks = commandsFromTracks(rows)
	}
	if len(tracks) == 0 {
		return nil, false
	}
	return tracks, true
}
