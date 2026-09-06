// Package board is the durable half of a rider's soundboard (#877, ADR-0033):
// the clips themselves, and nothing about a press. The fire is a room event
// on the hub's tick and is never written down.
//
// The scope is the whole point. Chat images belong to a room and die with its
// bounded log; a clip belongs to a RIDER and travels into every room they ride
// in, so membership cannot be the gate. The gate is "does the listener share a
// room with the owner right now", and only the hub knows that.
package board

import (
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const (
	// MaxClipMillis and MaxRiderBytes are SPEC's ceilings (docs/SPEC.md, room
	// audio defaults): a clip is at most 60 s, a rider's clips at most 100 MB.
	MaxClipMillis = 60_000
	MaxRiderBytes = 100 << 20

	// maxUploadBytes bounds the read before anything is measured. Sixty
	// seconds of MPEG 1 Layer III at its top bitrate is 320 kbps × 60 s ≈
	// 2.4 MB; the rest is slack for an ID3 tag carrying cover art. This is the
	// trust boundary, not the length rule — DurationMillis is that.
	maxUploadBytes = 4 << 20

	// Pads is how many a board has, and the migration's check constraint says
	// the same. Beyond that a clip lives in the library with no pad.
	Pads = 9

	// maxNameRunes keeps a clip's label to something a pad can render.
	maxNameRunes = 32
)

// Sharing is what the board borrows from the hub: where each rider is right
// now. Satisfied by *hub.Hub.
type Sharing interface {
	WhereIs(userIDs []string) map[string]string
}

// Auth is the signed-in gate, satisfied by *auth.Service.
type Auth interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

type Service struct {
	store *store.Store
	auth  Auth
	rooms Sharing
	log   *slog.Logger
}

func New(st *store.Store, auth Auth, rooms Sharing, log *slog.Logger) *Service {
	return &Service{store: st, auth: auth, rooms: rooms, log: log}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/board/clips", s.handleList)
	mux.HandleFunc("POST /api/board/clips", s.handleUpload)
	mux.HandleFunc("DELETE /api/board/clips/{id}", s.handleDelete)
	mux.HandleFunc("PUT /api/board/clips/{id}/pad", s.handlePad)
	mux.HandleFunc("GET /api/board/clips/{id}/audio", s.handleAudio)
}

func (s *Service) me(w http.ResponseWriter, r *http.Request) (db.User, bool) {
	return s.auth.RequireUser(w, r, "Sign in to use your soundboard.")
}

type clipJSON struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Pad      *int   `json:"pad,omitempty"`
	Millis   int    `json:"millis"`
	Bytes    int    `json:"bytes"`
	Uploaded int64  `json:"uploaded"`
}

type listJSON struct {
	Clips []clipJSON `json:"clips"`
	// Used and Limit let the library draw the meter without a second call,
	// and let it refuse an upload before spending the rider's bandwidth.
	Used  int64 `json:"used"`
	Limit int64 `json:"limit"`
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListBoardClips(r.Context(), me.ID)
	if err != nil {
		s.log.Error("list board clips", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your clips could not be loaded.")
		return
	}
	used, err := s.store.Queries.BoardClipBytes(r.Context(), me.ID)
	if err != nil {
		s.log.Error("board quota", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Your clips could not be loaded.")
		return
	}
	out := listJSON{Clips: make([]clipJSON, 0, len(rows)), Used: used, Limit: MaxRiderBytes}
	for _, row := range rows {
		clip := clipJSON{
			ID:       store.UUIDString(row.ID),
			Name:     row.Name,
			Millis:   int(row.DurationMs),
			Bytes:    int(row.SizeBytes),
			Uploaded: row.CreatedAt.Time.UnixMilli(),
		}
		if row.Pad != nil {
			pad := int(*row.Pad)
			clip.Pad = &pad
		}
		out.Clips = append(out.Clips, clip)
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// handleUpload takes the raw mp3 as the body and the label as ?name=, the way
// chat takes a pasted image. Three gates, in the order that spends the least
// on a body that will be refused: the byte cap bounds the read, the frame walk
// measures the length, and the quota asks whether it fits.
func (s *Service) handleUpload(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" || utf8.RuneCountInString(name) > maxNameRunes {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A clip needs a name, up to 32 characters.", "name")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxUploadBytes))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"A clip file is capped at 4 MB — a minute of audio is well under that.")
		return
	}
	millis, ok := DurationMillis(data)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"That file is not an MP3 this can read. Export it as MP3 and try again.")
		return
	}
	if millis > MaxClipMillis {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"A clip can be at most 60 seconds. Trim it before uploading.")
		return
	}
	used, err := s.store.Queries.BoardClipBytes(r.Context(), me.ID)
	if err != nil {
		s.log.Error("board quota", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The clip could not be saved.")
		return
	}
	// Not 429: the rider's move is to delete something, not to wait — so this
	// says what is wrong with the request rather than asking them to retry it.
	if used+int64(len(data)) > MaxRiderBytes {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"Your clips already fill 100 MB. Delete one to make room for this.")
		return
	}
	row, err := s.store.Queries.SaveBoardClip(r.Context(), db.SaveBoardClipParams{
		// Bounded by MaxClipMillis two checks above, so the narrowing is safe.
		UserID: me.ID, Name: name, DurationMs: int32(millis), //nolint:gosec // <= MaxClipMillis
		Bytes: data,
	})
	if err != nil {
		s.log.Error("save board clip", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The clip could not be saved.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, clipJSON{
		ID:       store.UUIDString(row.ID),
		Name:     name,
		Millis:   millis,
		Bytes:    len(data),
		Uploaded: row.CreatedAt.Time.UnixMilli(),
	})
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	n, err := s.store.Queries.DeleteBoardClip(r.Context(), db.DeleteBoardClipParams{ID: id, UserID: me.ID})
	if err != nil {
		s.log.Error("delete board clip", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The clip could not be deleted.")
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type padJSON struct {
	// null takes the clip off the board and leaves it in the library.
	Pad *int `json:"pad"`
}

// handlePad assigns a clip to a pad. Whatever was on that pad is bumped to the
// library first, so the unique index cannot refuse the write and the rider
// never has to clear a pad before reusing it.
func (s *Service) handlePad(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	var body padJSON
	if err := httpx.DecodeStrict(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a pad.")
		return
	}
	var pad *int16
	if body.Pad != nil {
		if *body.Pad < 1 || *body.Pad > Pads {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"The board has pads 1 to "+strconv.Itoa(Pads)+".", "pad")
			return
		}
		slot := int16(*body.Pad)
		pad = &slot
		if err := s.store.Queries.ClearBoardPad(r.Context(), db.ClearBoardPadParams{UserID: me.ID, Pad: &slot}); err != nil {
			s.log.Error("clear board pad", "err", err, "user", store.UUIDString(me.ID))
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The pad could not be set.")
			return
		}
	}
	n, err := s.store.Queries.SetBoardClipPad(r.Context(), db.SetBoardClipPadParams{ID: id, UserID: me.ID, Pad: pad})
	if err != nil {
		s.log.Error("set board pad", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The pad could not be set.")
		return
	}
	if n == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleAudio serves the bytes to anyone the owner is currently in a room
// with, and to the owner wherever they are. This is ADR-0033's authorization
// rule in one function: a clip is personal, so the question is never "are you
// a member of something" but "can you hear this rider right now".
func (s *Service) handleAudio(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	clip, err := s.store.Queries.GetBoardClip(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	listener, owner := store.UUIDString(me.ID), store.UUIDString(clip.UserID)
	if !s.canHear(listener, owner) {
		// Not 403: telling a stranger that a clip exists but is not for them
		// is more than they need to know about somebody else's board.
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such clip.")
		return
	}
	w.Header().Set("Content-Type", "audio/mpeg")
	// Rider-supplied bytes from the app's own origin: never let a browser
	// re-interpret one as anything but audio.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	_, _ = w.Write(clip.Bytes)
}

// canHear is the whole gate: your own clips anywhere, anyone else's only while
// you are in the same room as them.
func (s *Service) canHear(listener, owner string) bool {
	if listener == owner {
		return true
	}
	where := s.rooms.WhereIs([]string{listener, owner})
	// An empty slug is the lobby — being signed in at the same time is not
	// being in a room together.
	return where[listener] != "" && where[listener] == where[owner]
}
