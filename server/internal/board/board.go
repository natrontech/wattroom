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
	"strings"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/audio"
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

	// MaxPad is a sanity bound, not a ceiling: a pad is a position in a list,
	// and MaxRiderBytes is what actually limits how many a rider can have.
	// Nine was a number from the mockups and riders hit it on day one.
	MaxPad = 999

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
	mux.HandleFunc("PUT /api/board/clips/{id}/name", s.handleName)
	mux.HandleFunc("PUT /api/board/clips/{id}/key", s.handleKey)
	mux.HandleFunc("PUT /api/board/clips/{id}/edit", s.handleEdit)
	mux.HandleFunc("GET /api/board/clips/{id}/audio", s.handleAudio)
}

func (s *Service) me(w http.ResponseWriter, r *http.Request) (db.User, bool) {
	return s.auth.RequireUser(w, r, "Sign in to use your soundboard.")
}

type clipJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Pad  *int   `json:"pad,omitempty"`
	// The key that fires this clip, or absent for one that is only tapped.
	// A pad's number stopped being its key when the board outgrew nine.
	Key *string `json:"key,omitempty"`
	// Millis is the SOURCE's length; the edit below says what actually plays.
	Millis   int   `json:"millis"`
	Bytes    int   `json:"bytes"`
	Uploaded int64 `json:"uploaded"`
	editJSON
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
			editJSON: editJSON{
				StartMillis: int(row.StartMs),
				EndMillis:   int(row.EndMs),
				GainDb:      float64(row.GainDb),
				FadeInMs:    int(row.FadeInMs),
				FadeOutMs:   int(row.FadeOutMs),
			},
		}
		if row.Pad != nil {
			pad := int(*row.Pad)
			clip.Pad = &pad
		}
		clip.Key = row.Key
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
	defaultEnd := 0
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxUploadBytes))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"A clip file is capped at 4 MB — a minute of audio is well under that.")
		return
	}
	millis, ok := audio.DurationMillis(data)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"That file is not an MP3 this can read. Export it as MP3 and try again.")
		return
	}
	// A longer source is fine — the ceiling is on what plays, and the rider
	// trims it after uploading (#934). What bounds a hostile upload is the
	// byte cap above, not this.
	if millis > MaxClipMillis {
		defaultEnd = MaxClipMillis
	}
	// Asked with the rider's row locked, in the transaction that inserts
	// (#1413): parallel uploads each read the same "used" and each landed.
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.log.Error("board begin", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The clip could not be saved.")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	if err := q.LockUser(r.Context(), me.ID); err != nil {
		s.log.Error("board lock", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The clip could not be saved.")
		return
	}
	used, err := q.BoardClipBytes(r.Context(), me.ID)
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
	row, err := q.SaveBoardClip(r.Context(), db.SaveBoardClipParams{
		// Bounded by MaxClipMillis two checks above, so the narrowing is safe.
		UserID: me.ID, Name: name,
		DurationMs: int32(millis), //nolint:gosec // bounded by maxUploadBytes above
		Bytes:      data,
		// A source longer than the ceiling starts trimmed to it, so a clip can
		// never play past SPEC's minute even before anyone opens the editor.
		EndMs: int32(defaultEnd), //nolint:gosec // 0 or MaxClipMillis
	})
	if err != nil {
		s.log.Error("save board clip", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The clip could not be saved.")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.log.Error("board commit", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The clip could not be saved.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, clipJSON{
		ID:       store.UUIDString(row.ID),
		Name:     name,
		Millis:   millis,
		Bytes:    len(data),
		Uploaded: row.CreatedAt.Time.UnixMilli(),
		editJSON: editJSON{EndMillis: defaultEnd},
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

// MaxGainDb is as far as a clip can be pushed either way. Past this a rider is
// fixing a bad export with the wrong tool, and the room pays for it.
const MaxGainDb = 12

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
