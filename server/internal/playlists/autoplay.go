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

// The room's autoplay is its voice channel's since #2439: the worker reads
// the channel, so these read and write the channel too, until the room goes
// (#2446). A channel's own settings are its PATCH (#2434).
func autoplayJSONFrom(ch db.Channel) autoplayJSON {
	out := autoplayJSON{Enabled: ch.AutoplayEnabled, Order: ch.AutoplayOrder}
	if ch.AutoplayPlaylistID.Valid {
		out.ActivePlaylistID = store.UUIDString(ch.AutoplayPlaylistID)
	}
	return out
}

func (s *Service) handleGetAutoplay(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.roomScope(w, r)
	if !ok {
		return
	}
	ch, err := s.store.Queries.GetChannel(r.Context(), sc.voice)
	if err != nil {
		httpx.Fail(w, s.log, "autoplay read failed", err, "Autoplay could not be loaded.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, autoplayJSONFrom(ch))
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
	// that was not the crew's was refused after the first two had committed.
	var active pgtype.UUID
	if activeID := strings.TrimSpace(req.ActivePlaylistID); activeID != "" {
		id, err := store.ParseUUID(activeID)
		if err != nil {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That playlist does not exist.", "activePlaylistId")
			return
		}
		active = id
	}
	ch, err := s.store.Queries.SetChannelAutoplay(r.Context(), db.SetChannelAutoplayParams{
		ID: sc.voice, AutoplayEnabled: req.Enabled, AutoplayOrder: req.Order, AutoplayPlaylistID: active,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// The channel was resolved this request, so the ownership clause is
		// what declined it — unless the channel itself has just been deleted.
		if !active.Valid {
			httpx.WriteError(w, http.StatusNotFound, "not_found", "That room's voice channel is gone.")
			return
		}
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That playlist is not one of this crew's own.", "activePlaylistId")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "save autoplay failed", err, "Autoplay could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, autoplayJSONFrom(ch))
}

// validAutoplayOrder: the three orders autoplay walks the active playlist in
// (#1429). "ordered" and "shuffled" take every entry; "smart" (#269) takes
// the list's library tracks weighted by this room's play/skip history, and
// the members' whole libraries when the list holds none. One setting: a
// channel picks an order, and the source is always its playlist.
func validAutoplayOrder(order string) bool {
	return order == "ordered" || order == "shuffled" || order == "smart"
}

// Autoplay implements hub.AutoplaySource (#627): read once per join-onto-an-
// idle-deck, entirely outside the hub's lock. The settings are the voice
// channel's own (ADR-0058, #2439), set on the channel by the crew's owner or
// an admin. One source, three orders (#1429): the active crew playlist,
// walked in list order, freshly shuffled once per trigger, or — "smart"
// (#269) — its library tracks drawn by this channel's history, weighted
// since #270 toward the cadence `mood` says the session is turning right
// now. Smart with no active playlist, or one holding no library track, draws
// from the whole libraries of the riders who may enter the channel instead.
func (s *Service) Autoplay(ctx context.Context, channel string, mood hub.SessionMood) (tracks []protocol.JukeboxCommand, ok bool) {
	channelID, err := store.ParseUUID(channel)
	if err != nil {
		return nil, false
	}
	ch, err := s.store.Queries.GetChannel(ctx, channelID)
	if err != nil || !ch.AutoplayEnabled {
		return nil, false
	}
	var rows []db.ListPlaylistTracksRow
	if ch.AutoplayPlaylistID.Valid {
		if rows, err = s.store.Queries.ListPlaylistTracks(ctx, ch.AutoplayPlaylistID); err != nil {
			s.log.Error("autoplay: list playlist tracks failed", "channel", channel, "err", err)
			return nil, false
		}
	}
	switch ch.AutoplayOrder {
	case "smart":
		var only []pgtype.UUID
		for _, row := range rows {
			if row.TrackID.Valid {
				only = append(only, row.TrackID)
			}
		}
		tracks = s.smartShuffle(ctx, ch.ID, mood, only)
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
