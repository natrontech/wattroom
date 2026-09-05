// Package playlists is the saved half of the jukebox (#627): room playlists
// (survive past any one queue, editable by any member, one markable active
// for autoplay) and personal playlists (a rider's own, usable in any room).
// Distinct from a queued-whole YouTube playlist (docs/SPEC.md "Playlist",
// #615) — this package never touches the live deck directly, it only reads
// and writes the shelf and, through Live, asks the hub to queue from it.
package playlists

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// UserSource resolves the signed-in user — same shape rooms/customworkouts
// consume. Personal playlists need nothing more.
type UserSource interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// Members is the room-scoped gate (#638), satisfied by *rooms.Service — the
// same one chat stands behind, so a ban refuses the shelf like everything else.
type Members interface {
	RequireMember(w http.ResponseWriter, r *http.Request, refusal string) (db.Room, db.User, bool)
}

// Live pushes a saved playlist's tracks onto a room's live queue (#627) —
// mirrors chat.Live for the same reason: this arrives over HTTP, and the
// deck it lands on is the hub's problem. Nil means no live room reachable;
// the playlist itself is unaffected either way.
type Live interface {
	QueuePlaylist(slug, riderID, addedBy string, tracks []protocol.JukeboxCommand) (addedCount int, ok bool)
}

type Service struct {
	store   *store.Store
	users   UserSource
	members Members
	live    Live
	log     *slog.Logger
}

func New(st *store.Store, users UserSource, members Members, log *slog.Logger) *Service {
	return &Service{store: st, users: users, members: members, log: log}
}

// SetLive wires the queue-into-room bridge in after construction, like
// chat's SetLive. Nil stays valid — "queue" just fails as "no room" would.
func (s *Service) SetLive(l Live) { s.live = l }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/rooms/{slug}/playlists", s.handleListRoomPlaylists)
	mux.HandleFunc("POST /api/rooms/{slug}/playlists", s.handleCreateRoomPlaylist)
	mux.HandleFunc("GET /api/rooms/{slug}/playlists/{id}", s.handleGetRoomPlaylist)
	mux.HandleFunc("PUT /api/rooms/{slug}/playlists/{id}", s.handleRenameRoomPlaylist)
	mux.HandleFunc("DELETE /api/rooms/{slug}/playlists/{id}", s.handleDeleteRoomPlaylist)
	mux.HandleFunc("POST /api/rooms/{slug}/playlists/{id}/tracks", s.handleAddRoomTrack)
	mux.HandleFunc("DELETE /api/rooms/{slug}/playlists/{id}/tracks/{trackID}", s.handleDeleteRoomTrack)
	mux.HandleFunc("POST /api/rooms/{slug}/playlists/{id}/queue", s.handleQueuePlaylist)
	mux.HandleFunc("GET /api/rooms/{slug}/autoplay", s.handleGetAutoplay)
	mux.HandleFunc("PATCH /api/rooms/{slug}/autoplay", s.handleUpdateAutoplay)

	mux.HandleFunc("GET /api/playlists", s.handleListPersonalPlaylists)
	mux.HandleFunc("POST /api/playlists", s.handleCreatePersonalPlaylist)
	mux.HandleFunc("GET /api/playlists/{id}", s.handleGetPersonalPlaylist)
	mux.HandleFunc("PUT /api/playlists/{id}", s.handleRenamePersonalPlaylist)
	mux.HandleFunc("DELETE /api/playlists/{id}", s.handleDeletePersonalPlaylist)
	mux.HandleFunc("POST /api/playlists/{id}/tracks", s.handleAddPersonalTrack)
	mux.HandleFunc("DELETE /api/playlists/{id}/tracks/{trackID}", s.handleDeletePersonalTrack)
}

// scope is who the caller is allowed to touch: a room they belong to, or
// their own personal shelf. Exactly one of room/user is meaningful — room's
// zero value never satisfies a room-owned playlist's check.
type scope struct {
	room db.Room
	user db.User
	// asRoom is false for the personal shelf, where room stays the zero
	// value and every check goes through user instead.
	asRoom bool
}

// roomScope resolves the signed-in member of the room named by {slug} — any
// member, not just owner/coach, per docs/SPEC.md's jukebox-controls-are-
// member-level row.
func (s *Service) roomScope(w http.ResponseWriter, r *http.Request) (scope, bool) {
	room, user, ok := s.members.RequireMember(w, r, "Join the room to manage its playlists.")
	if !ok {
		return scope{}, false
	}
	return scope{room: room, user: user, asRoom: true}, true
}

func (s *Service) personalScope(w http.ResponseWriter, r *http.Request) (scope, bool) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return scope{}, false
	}
	return scope{user: user}, true
}

// ownerParams is what CreatePlaylist takes for this scope: exactly one of
// room_id/user_id valid, matching the table's check constraint.
func (sc scope) ownerParams(name string) db.CreatePlaylistParams {
	if sc.asRoom {
		return db.CreatePlaylistParams{RoomID: sc.room.ID, Name: name}
	}
	return db.CreatePlaylistParams{UserID: sc.user.ID, Name: name}
}

// owns reports whether p belongs to this scope — the ownership check every
// mutation runs before touching a playlist by id.
func (sc scope) owns(p db.Playlist) bool {
	if sc.asRoom {
		return p.RoomID.Valid && p.RoomID == sc.room.ID
	}
	return p.UserID.Valid && p.UserID == sc.user.ID
}

// ownedPlaylist fetches {id} and checks it against sc.owns — a mismatch is a
// 404, same as absent: no probing which ids exist in a room you're not in.
func (s *Service) ownedPlaylist(w http.ResponseWriter, r *http.Request, sc scope) (db.Playlist, bool) {
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That playlist does not exist.")
		return db.Playlist{}, false
	}
	p, err := s.store.Queries.GetPlaylist(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !sc.owns(p)) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That playlist does not exist.")
		return db.Playlist{}, false
	}
	if err != nil {
		s.log.Error("playlist lookup failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The playlist could not be loaded.")
		return db.Playlist{}, false
	}
	return p, true
}

type playlistJSON struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	TrackCount int64  `json:"trackCount"`
	Active     bool   `json:"active,omitempty"`
	UpdatedAt  int64  `json:"updatedAt"`
}

func (s *Service) handleListRoomPlaylists(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.roomScope(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListRoomPlaylists(r.Context(), sc.room.ID)
	if err != nil {
		s.log.Error("list room playlists failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The playlists could not be loaded.")
		return
	}
	out := make([]playlistJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, playlistJSON{
			ID: store.UUIDString(row.ID), Name: row.Name, TrackCount: row.TrackCount,
			Active:    sc.room.AutoplayPlaylistID.Valid && sc.room.AutoplayPlaylistID == row.ID,
			UpdatedAt: row.UpdatedAt.Time.UnixMilli(),
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"playlists": out})
}

func (s *Service) handleListPersonalPlaylists(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.personalScope(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListUserPlaylists(r.Context(), sc.user.ID)
	if err != nil {
		s.log.Error("list personal playlists failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your playlists could not be loaded.")
		return
	}
	out := make([]playlistJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, playlistJSON{
			ID: store.UUIDString(row.ID), Name: row.Name, TrackCount: row.TrackCount,
			UpdatedAt: row.UpdatedAt.Time.UnixMilli(),
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"playlists": out})
}

type nameRequest struct {
	Name string `json:"name"`
}

func checkName(name string) (code, message string) {
	// Runes, not bytes (audit #219, hub.go's chat length check): counting
	// bytes cuts a non-Latin name off at half the advertised limit.
	if n := utf8.RuneCountInString(name); n == 0 || n > 80 {
		return "validation_error", "A playlist name has to be 1-80 characters."
	}
	return "", ""
}

func (s *Service) createPlaylist(w http.ResponseWriter, r *http.Request, sc scope) {
	var req nameRequest
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	name := strings.TrimSpace(req.Name)
	if code, message := checkName(name); code != "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, code, message, "name")
		return
	}
	p, err := s.store.Queries.CreatePlaylist(r.Context(), sc.ownerParams(name))
	if err != nil {
		s.log.Error("create playlist failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The playlist could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, playlistJSON{
		ID: store.UUIDString(p.ID), Name: p.Name, UpdatedAt: p.UpdatedAt.Time.UnixMilli(),
	})
}

func (s *Service) handleCreateRoomPlaylist(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.roomScope(w, r); ok {
		s.createPlaylist(w, r, sc)
	}
}

func (s *Service) handleCreatePersonalPlaylist(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.personalScope(w, r); ok {
		s.createPlaylist(w, r, sc)
	}
}

func (s *Service) renamePlaylist(w http.ResponseWriter, r *http.Request, sc scope) {
	p, ok := s.ownedPlaylist(w, r, sc)
	if !ok {
		return
	}
	var req nameRequest
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	name := strings.TrimSpace(req.Name)
	if code, message := checkName(name); code != "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, code, message, "name")
		return
	}
	updated, err := s.store.Queries.RenamePlaylist(r.Context(), db.RenamePlaylistParams{ID: p.ID, Name: name})
	if err != nil {
		s.log.Error("rename playlist failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The playlist could not be renamed. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, playlistJSON{
		ID: store.UUIDString(updated.ID), Name: updated.Name, UpdatedAt: updated.UpdatedAt.Time.UnixMilli(),
	})
}

func (s *Service) handleRenameRoomPlaylist(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.roomScope(w, r); ok {
		s.renamePlaylist(w, r, sc)
	}
}

func (s *Service) handleRenamePersonalPlaylist(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.personalScope(w, r); ok {
		s.renamePlaylist(w, r, sc)
	}
}

func (s *Service) deletePlaylist(w http.ResponseWriter, r *http.Request, sc scope) {
	p, ok := s.ownedPlaylist(w, r, sc)
	if !ok {
		return
	}
	if _, err := s.store.Queries.DeletePlaylist(r.Context(), p.ID); err != nil {
		s.log.Error("delete playlist failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The playlist could not be deleted. Try again.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleDeleteRoomPlaylist(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.roomScope(w, r); ok {
		s.deletePlaylist(w, r, sc)
	}
}

func (s *Service) handleDeletePersonalPlaylist(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.personalScope(w, r); ok {
		s.deletePlaylist(w, r, sc)
	}
}
