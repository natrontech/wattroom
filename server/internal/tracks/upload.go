// The upload (ADR-0015): the one write that takes bytes rather than JSON,
// and the tag reading that turns a file name and an ID3 header into a row.
// Split from tracks.go for size; the routes, the list and the edits stay there.
package tracks

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/dhowden/tag"
	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/audio"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

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
		// The row can outlive its bytes: the audio directory is a volume the
		// deployment has to persist, and a deploy that does not lands every
		// rider here with a shelf full of tracks that 404 on play (#1715).
		// Re-uploading the file is exactly the repair, so write it — `put`
		// stats first and skips when the content really is there, which is
		// the ordinary case. Without this the duplicate check hands back the
		// broken row and the only way out is delete-then-upload.
		if _, err := s.put(sha, data); err != nil {
			s.log.Error("track rewrite", "err", err, "sha", sha)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The track could not be saved.")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, toJSON(existing, ""))
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		s.log.Error("track lookup", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The track could not be saved.")
		return
	}

	// The quota is asked with the rider's row locked, in the transaction that
	// inserts (#1413): parallel uploads each read the same "used" and each
	// landed, bypassing it by about the quota.
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.log.Error("track begin", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The track could not be saved.")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	if err := q.LockUser(r.Context(), me.ID); err != nil {
		s.log.Error("track lock", "err", err, "user", store.UUIDString(me.ID))
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "The track could not be saved.")
		return
	}
	used, err := q.TrackQuotaUsed(r.Context(), me.ID)
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
	row, err := q.CreateTrack(r.Context(), db.CreateTrackParams{
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
	if err := tx.Commit(r.Context()); err != nil {
		s.log.Error("track commit", "err", err, "sha", sha)
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
