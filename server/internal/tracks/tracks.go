// Package tracks is the self-hosted music pool's server side (#266, ADR-0015):
// one global library of uploaded MP3s that every signed-in rider browses, with
// the audio on disk and the metadata in Postgres.
//
// Three departures from ADR-0015, each cheaper than what it replaces:
//
//   - Duration is measured from the file's own frames rather than taken from
//     the uploading browser's `audio.duration`. #877 already wrote that walker
//     for the soundboard; a number the client supplies is also a number the
//     client can get wrong.
//   - MP3-only is enforced by the same walker, so "is this an MP3" and "how
//     long is it" are one answer rather than two guesses.
//   - A duplicate upload returns the existing track and stores nothing, so it
//     charges nobody's quota. The ADR says duplicates dedupe to one file; this
//     is what that means for the row.
package tracks

import (
	"bytes"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dhowden/tag"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/audio"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const (
	// MaxRiderBytes is ADR-0015's quota: 2 GB per rider.
	MaxRiderBytes = 2 << 30

	// maxUploadBytes bounds the read before anything is measured — the trust
	// boundary, not a length rule. Ten minutes of MPEG 1 Layer III at its top
	// bitrate is 320 kbps x 600 s ~ 24 MB; the rest is slack for an ID3 tag
	// carrying cover art. A DJ set longer than that is not what this is for.
	maxUploadBytes = 48 << 20

	// A title has to fit a queue row and a now-playing line.
	maxTextRunes = 200

	// A tag is a word or two on a chip, and a track wears a handful. Both are
	// bounds on what can be stored, not a taxonomy — ADR-0015 is explicit that
	// there isn't one.
	maxTagRunes = 40
	maxTags     = 20

	// The pool is browsed a page at a time; the client asks, this bounds it.
	defaultLimit = 100
	maxLimit     = 500
)

// Auth is the signed-in gate, satisfied by *auth.Service.
type Auth interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

type Service struct {
	store *store.Store
	auth  Auth
	log   *slog.Logger
	dir   string
}

func New(st *store.Store, a Auth, log *slog.Logger) *Service {
	dir := os.Getenv("WATTROOM_TRACKS_DIR")
	if dir == "" {
		dir = "tracks"
	}
	return &Service{store: st, auth: a, log: log, dir: dir}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/tracks", s.handleUpload)
	mux.HandleFunc("GET /api/tracks", s.handleList)
	mux.HandleFunc("GET /api/tracks/{id}/audio", s.handleAudio)
	mux.HandleFunc("PATCH /api/tracks/{id}", s.handleUpdate)
	mux.HandleFunc("DELETE /api/tracks/{id}", s.handleDelete)
}

func (s *Service) me(w http.ResponseWriter, r *http.Request) (db.User, bool) {
	return s.auth.RequireUser(w, r, "Sign in to use the music pool.")
}

type trackJSON struct {
	Id         string   `json:"id"`
	Title      string   `json:"title"`
	Artist     string   `json:"artist,omitempty"`
	Album      string   `json:"album,omitempty"`
	DurationMs int32    `json:"durationMs"`
	SizeBytes  int32    `json:"sizeBytes"`
	Bpm        int16    `json:"bpm,omitempty"`
	Tags       []string `json:"tags"`
	UploadedBy string   `json:"uploadedBy,omitempty"`
	CreatedAt  string   `json:"createdAt"`
}

// tagJSON is a shelf label: the tag and how many tracks wear it.
type tagJSON struct {
	Tag    string `json:"tag"`
	Tracks int64  `json:"tracks"`
}

func toJSON(t db.Track, uploader string) trackJSON {
	out := trackJSON{
		Id: store.UUIDString(t.ID), Title: t.Title, Artist: t.Artist, Album: t.Album,
		DurationMs: t.DurationMs, SizeBytes: t.SizeBytes,
		// Never nil: a track with no tags is `[]` rather than `null`, so the
		// client can iterate it without asking which one it got.
		Tags:       append([]string{}, t.Tags...),
		UploadedBy: uploader,
		CreatedAt:  t.CreatedAt.Time.Format(time.RFC3339),
	}
	if t.Bpm != nil {
		out.Bpm = *t.Bpm
	}
	return out
}

/*
handleUpload takes the raw MP3 as the body and the filename as ?name=, the way
the soundboard takes a clip. Multipart would buy nothing here: there is one
file and one string, and the string is only a fallback for a missing ID3 title.

The gates run in the order that spends least on a body that will be refused:
the byte cap bounds the read, the frame walk decides whether it is an MP3 at
all, the content address asks whether we already have it, and only then does
the quota get consulted.
*/
func (s *Service) handleUpload(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxUploadBytes))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"A track is capped at 48 MB — ten minutes of MP3 is well under that.")
		return
	}
	millis, ok := audio.DurationMillis(data)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"That file is not an MP3 this can read. Export it as MP3 and try again.")
		return
	}

	// Already on THIS rider's shelf: hand back the row that is there. Not an
	// error — they uploaded a song they already had and have what they
	// wanted. Somebody else holding the same content is not this check's
	// business any more (#1095): they get a row of their own below, and
	// `put` skips the write because the bytes are already on disk.
	sha := Address(data)
	if existing, err := s.store.Queries.TrackBySha(r.Context(), db.TrackByShaParams{
		UploadedBy: me.ID, Sha256: sha,
	}); err == nil {
		httpx.WriteJSON(w, http.StatusOK, toJSON(existing, ""))
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		s.log.Error("track lookup", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The track could not be saved.")
		return
	}

	used, err := s.store.Queries.TrackQuotaUsed(r.Context(), me.ID)
	if err != nil {
		s.log.Error("track quota", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The track could not be saved.")
		return
	}
	// Not 429: the rider's move is to delete something, not to wait — so this
	// says what is wrong with the request rather than asking them to retry it.
	if used+int64(len(data)) > MaxRiderBytes {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"Your uploads already fill 2 GB. Delete a track to make room for this.")
		return
	}

	title, artist, album, bpm, tags := metadata(data, r.URL.Query().Get("name"))
	if _, err := s.put(sha, data); err != nil {
		s.log.Error("track write", "err", err, "sha", sha)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The track could not be saved.")
		return
	}
	row, err := s.store.Queries.CreateTrack(r.Context(), db.CreateTrackParams{
		Sha256: sha, UploadedBy: me.ID,
		Title: title, Artist: artist, Album: album,
		DurationMs: int32(millis),    //nolint:gosec // bounded by maxUploadBytes above
		SizeBytes:  int32(len(data)), //nolint:gosec // bounded by maxUploadBytes above
		Bpm:        bpm,
		Tags:       tags,
	})
	if err != nil {
		// The file stays: another upload of the same content will find it and
		// skip the write, and an orphan costs disk rather than correctness.
		s.log.Error("track insert", "err", err, "sha", sha)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The track could not be saved.")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toJSON(row, me.DisplayName))
}

// metadata reads what the ID3 tag claims, falling back to the filename for a
// title. Real-world tags are garbage and every field is editable afterwards
// (ADR-0015), so nothing here has to be right — only present and bounded.
//
// The genre frame seeds the track's tags the same way TBPM seeds its BPM: one
// tag a rider can keep, rename or delete. It is a starting point, not a
// taxonomy — ADR-0015 says there is none.
func metadata(data []byte, filename string) (title, artist, album string, bpm *int16, tags []string) {
	fallback := strings.TrimSuffix(strings.TrimSpace(filename), ".mp3")
	tags = []string{}
	if m, err := tag.ReadFrom(bytes.NewReader(data)); err == nil {
		title, artist, album = clip(m.Title()), clip(m.Artist()), clip(m.Album())
		tags = normalizeTags(strings.Split(m.Genre(), "/"))
		if raw, ok := m.Raw()["TBPM"]; ok {
			if n, err := strconv.Atoi(strings.TrimSpace(toText(raw))); err == nil && n > 0 && n < 400 {
				beats := int16(n) //nolint:gosec // bounded to 1..399 on the line above
				bpm = &beats
			}
		}
	}
	if title == "" {
		title = clip(fallback)
	}
	if title == "" {
		title = "Untitled"
	}
	return title, artist, album, bpm, tags
}

/*
normalizeTags is what makes an array column enough on its own: two riders who
type "Italo Disco" and "italo disco " mean one tag, and the only thing that can
make them equal is that the stored string is equal. Lower-cased, collapsed,
de-duplicated, order preserved so a rider's own list reads the way they typed
it, and bounded on both axes.
*/
func normalizeTags(in []string) []string {
	out := make([]string, 0, len(in))
	seen := make(map[string]bool, len(in))
	for _, raw := range in {
		t := strings.ToLower(strings.Join(strings.Fields(raw), " "))
		if utf8.RuneCountInString(t) > maxTagRunes {
			t = string([]rune(t)[:maxTagRunes])
		}
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
		if len(out) == maxTags {
			break
		}
	}
	return out
}

func toText(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func clip(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= maxTextRunes {
		return s
	}
	return string([]rune(s)[:maxTextRunes])
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	limit, offset := defaultLimit, 0
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		limit = min(n, maxLimit)
	}
	if n, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && n > 0 {
		offset = n
	}
	// One tag, not a set: narrowing by two at once is a query nobody has asked
	// for, and the facet row is one click deep.
	// ponytail: single tag. Take a repeated ?tag= into an `@>` array containment
	// clause if riders start combining them.
	tag := ""
	if picked := normalizeTags([]string{r.URL.Query().Get("tag")}); len(picked) == 1 {
		tag = picked[0]
	}
	rows, err := s.store.Queries.ListTracks(r.Context(), db.ListTracksParams{
		UploadedBy: me.ID,
		Search:     strings.TrimSpace(r.URL.Query().Get("q")),
		Tag:        tag,
		Lim:        int32(limit), Off: int32(offset), //nolint:gosec // bounded above
	})
	if err != nil {
		s.log.Error("track list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The music pool could not be read.")
		return
	}
	// The shelf labels, over the whole pool rather than this page: a rider
	// filtering to one tag still needs the others to get back out.
	facets, err := s.store.Queries.TrackTagCounts(r.Context(), me.ID)
	if err != nil {
		s.log.Error("track tag counts", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The music pool could not be read.")
		return
	}
	out := make([]trackJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, toJSON(db.Track{
			ID: row.ID, Sha256: row.Sha256, UploadedBy: row.UploadedBy,
			Title: row.Title, Artist: row.Artist, Album: row.Album,
			DurationMs: row.DurationMs, SizeBytes: row.SizeBytes,
			Bpm: row.Bpm, Tags: row.Tags, CreatedAt: row.CreatedAt,
		}, row.UploadedByName))
	}
	tags := make([]tagJSON, 0, len(facets))
	for _, f := range facets {
		tags = append(tags, tagJSON{Tag: f.Tag, Tracks: f.Tracks})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tracks": out, "tags": tags})
}

// handleAudio serves the file itself. http.ServeContent gives range requests,
// seeking and caching for free — which is the whole reason ADR-0015 puts the
// audio on disk rather than in a bytea column.
func (s *Service) handleAudio(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	// Not s.track: playing is wider than browsing (#1095). Every rider in a
	// room fetches whatever pool track the deck is on, so an uploader-only
	// scope here would play a queued track for its owner and nobody else.
	row, ok := s.playable(w, r, me)
	if !ok {
		return
	}
	f, info, err := s.open(row.Sha256)
	if err != nil {
		s.log.Error("track open", "err", err, "sha", row.Sha256)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That track could not be played.")
		return
	}
	defer func() { _ = f.Close() }()
	// Login-gated and never public (ADR-0015's copyright fence), so this must
	// not end up in a shared cache between riders.
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("Content-Type", "audio/mpeg")
	http.ServeContent(w, r, row.Title+".mp3", info.ModTime(), f)
}

func (s *Service) handleUpdate(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	row, ok := s.track(w, r, me)
	if !ok {
		return
	}
	var req struct {
		Title  string   `json:"title"`
		Artist string   `json:"artist"`
		Album  string   `json:"album"`
		Bpm    *int16   `json:"bpm"`
		Tags   []string `json:"tags"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	title := clip(req.Title)
	if title == "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A track needs a title.", "title")
		return
	}
	if req.Bpm != nil && (*req.Bpm <= 0 || *req.Bpm >= 400) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A BPM is between 1 and 399.", "bpm")
		return
	}
	updated, err := s.store.Queries.UpdateTrack(r.Context(), db.UpdateTrackParams{
		ID: row.ID, UploadedBy: me.ID,
		Title: title, Artist: clip(req.Artist), Album: clip(req.Album), Bpm: req.Bpm,
		// Normalized rather than rejected: a rider typing "Italo Disco, italo
		// disco" made one tag, and telling them off for it would be the
		// taxonomy ADR-0015 says not to build.
		Tags: normalizeTags(req.Tags),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// The row exists — s.track found it — so the only way to miss here is
		// that it belongs to somebody else.
		httpx.WriteError(w, http.StatusForbidden, "forbidden",
			"Only whoever uploaded a track can edit it.")
		return
	}
	if err != nil {
		s.log.Error("track update", "err", err, "track", store.UUIDString(row.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The track could not be saved.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(updated, me.DisplayName))
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	row, ok := s.track(w, r, me)
	if !ok {
		return
	}
	gone, err := s.store.Queries.DeleteTrack(r.Context(), db.DeleteTrackParams{
		ID: row.ID, UploadedBy: me.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden",
			"Only whoever uploaded a track can delete it.")
		return
	}
	if err != nil {
		s.log.Error("track delete", "err", err, "track", store.UUIDString(row.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The track could not be deleted.")
		return
	}
	// One blob per sha however many shelves hold it (#1095), so the file goes
	// only with the LAST row that points at it. Removing it while somebody
	// else still holds the row would break their playback, and nothing would
	// say so until they pressed play.
	if gone.Others > 0 {
		s.log.Info("track row deleted, file kept", "sha", gone.Sha256, "othersHolding", gone.Others)
	} else if err := s.remove(gone.Sha256); err != nil {
		// The row is gone, which is what the rider asked for. A file nothing
		// points at is disk to reclaim, not a failed request to report.
		s.log.Error("track file remove", "err", err, "sha", gone.Sha256)
	}
	w.WriteHeader(http.StatusNoContent)
}

// playable resolves {id} for LISTENING: the caller's own track, or one
// uploaded by somebody they share a room with. Same 404-not-403 rule as
// track() — a track outside the caller's reach is absent, not refused.
func (s *Service) playable(w http.ResponseWriter, r *http.Request, me db.User) (db.Track, bool) {
	var id pgtype.UUID
	if err := id.Scan(r.PathValue("id")); err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That track does not exist.")
		return db.Track{}, false
	}
	row, err := s.store.Queries.TrackPlayableBy(r.Context(), db.TrackPlayableByParams{ID: id, UserID: me.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That track does not exist.")
		return db.Track{}, false
	}
	if err != nil {
		s.log.Error("track playable", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That track could not be read.")
		return db.Track{}, false
	}
	return row, true
}

// track resolves {id} within the caller's own shelf and 404s on everything
// else (#1095). Scoping lives in the query, so a track belonging to someone
// else is not "forbidden" — it is absent. That distinction is the point:
// answering 403 would confirm to a stranger that the id names a real track.
func (s *Service) track(w http.ResponseWriter, r *http.Request, me db.User) (db.Track, bool) {
	var id pgtype.UUID
	if err := id.Scan(r.PathValue("id")); err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That track does not exist.")
		return db.Track{}, false
	}
	row, err := s.store.Queries.GetTrack(r.Context(), db.GetTrackParams{ID: id, UploadedBy: me.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That track does not exist.")
		return db.Track{}, false
	}
	if err != nil {
		s.log.Error("track get", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "That track could not be read.")
		return db.Track{}, false
	}
	return row, true
}
