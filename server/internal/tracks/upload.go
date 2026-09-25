// The upload (ADR-0015): the one write that takes bytes rather than JSON,
// and the tag reading that turns a file name and an ID3 header into a row.
// Split from tracks.go for size; the routes, the list and the edits stay there.
package tracks

import (
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dhowden/tag"
	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/audio"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/textx"
)

func (s *Service) handleUpload(w http.ResponseWriter, r *http.Request) {
	me, ok := s.me(w, r)
	if !ok {
		return
	}
	// One upload per rider at a time (#2862). Each one holds a connection and
	// a file of up to 48 MB being written, then walked; a requests-per-hour
	// budget would still let fifty run at once.
	if !s.uploading.Acquire(me.ID) {
		httpx.WriteCeiling(w, "A track is already uploading. Wait for it to finish, then send the next.")
		return
	}
	defer s.uploading.Release(me.ID)
	// The server keeps no ReadTimeout — its sockets must not have one — so a
	// body that stalls would hold its slot and its file for as long as the
	// connection stayed open. A recorder in a test cannot take a deadline.
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(uploadReadBudget))

	// Read whole even when it is junk: answering before the body is in
	// makes the server close on a client still sending, which then reports a
	// dropped connection instead of this refusal.
	file, sha, size, err := s.receive(http.MaxBytesReader(w, r.Body, maxUploadBytes))
	var tooBig *http.MaxBytesError
	var disk *fs.PathError
	switch {
	case errors.As(err, &tooBig):
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"A track is capped at 48 MB — ten minutes of MP3 is well under that.")
		return
	case errors.As(err, &disk):
		httpx.Fail(w, s.log, "track receive", err, "The track could not be saved.")
		return
	case err != nil:
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"The upload did not arrive whole. Try it again.")
		return
	}
	// Closed and removed on every way out; once placed, the name is gone and
	// the remove is a no-op.
	defer func() {
		_ = file.Close()
		_ = os.Remove(file.Name())
	}()
	millis, ok := audio.DurationMillisFrom(rewound(file))
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", notAnMP3)
		return
	}

	// Already on THIS rider's shelf: hand back the row that is there. Not an
	// error — they uploaded a song they already had and have what they
	// wanted. Somebody else holding the same content is not this check's
	// business any more (#1095): they get a row of their own below, and
	// `place` skips the move because the bytes are already on disk.
	if existing, err := s.store.Queries.TrackBySha(r.Context(), db.TrackByShaParams{
		UploadedBy: me.ID, Sha256: sha,
	}); err == nil {
		// The row can outlive its bytes: the audio directory is a volume the
		// deployment has to persist, and a deploy that does not lands every
		// rider here with a shelf full of tracks that 404 on play (#1715).
		// Re-uploading the file is exactly the repair, so place it — `place`
		// stats first and skips when the content really is there, which is
		// the ordinary case. Without this the duplicate check hands back the
		// broken row and the only way out is delete-then-upload.
		if _, err := s.place(sha, file); err != nil {
			httpx.Fail(w, s.log, "track rewrite", err, "The track could not be saved.", "sha", sha)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, toJSON(existing, ""))
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(w, s.log, "track lookup", err, "The track could not be saved.")
		return
	}

	// The quota is asked with the rider's row locked, in the transaction that
	// inserts (#1413): parallel uploads each read the same "used" and each
	// landed, bypassing it by about the quota.
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		httpx.Fail(w, s.log, "track begin", err, "The track could not be saved.", "user", store.UUIDString(me.ID))
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	q := s.store.Queries.WithTx(tx)
	if err := q.LockUser(r.Context(), me.ID); err != nil {
		httpx.Fail(w, s.log, "track lock", err, "The track could not be saved.", "user", store.UUIDString(me.ID))
		return
	}
	used, err := q.TrackQuotaUsed(r.Context(), me.ID)
	if err != nil {
		httpx.Fail(w, s.log, "track quota", err, "The track could not be saved.", "user", store.UUIDString(me.ID))
		return
	}
	// A ceiling, so a 429 (SPEC:79-81). It used to be a 400 on the grounds
	// that the rider's move is to delete rather than to wait — which is the
	// objection SPEC considered and overruled in the same sentence, and the
	// message is where "do not wait" is said (#2244).
	if used+size > MaxRiderBytes {
		httpx.WriteCeiling(w, "Your uploads already fill 2 GB. Delete a track to make room for this.")
		return
	}

	title, artist, album, bpm, tags := metadata(rewound(file), r.URL.Query().Get("name"))
	if _, err := s.place(sha, file); err != nil {
		httpx.Fail(w, s.log, "track write", err, "The track could not be saved.", "sha", sha)
		return
	}
	row, err := q.CreateTrack(r.Context(), db.CreateTrackParams{
		Sha256: sha, UploadedBy: me.ID,
		Title: title, Artist: artist, Album: album,
		DurationMs: int32(millis), //nolint:gosec // bounded by maxUploadBytes above
		SizeBytes:  int32(size),   //nolint:gosec // bounded by maxUploadBytes above
		Bpm:        bpm,
		Tags:       tags,
	})
	if err != nil {
		// The file stays: another upload of the same content will find it and
		// skip the write, and an orphan costs disk rather than correctness.
		httpx.Fail(w, s.log, "track insert", err, "The track could not be saved.", "sha", sha)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Fail(w, s.log, "track commit", err, "The track could not be saved.", "sha", sha)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toJSON(row, me.DisplayName))
}

const notAnMP3 = "That file is not an MP3 this can read. Export it as MP3 and try again."

// rewound is the received file from its first byte again, for the next reader.
// A seek on a file this handler just wrote cannot fail short of the disk
// going away, and then the reader that follows fails too.
func rewound(f *os.File) *os.File {
	_, _ = f.Seek(0, io.SeekStart)
	return f
}

// metadata reads what the ID3 tag claims, falling back to the filename for a
// title. Real-world tags are garbage and every field is editable afterwards
// (ADR-0015), so nothing here has to be right — only present and bounded.
//
// The genre frame seeds the track's tags the same way TBPM seeds its BPM: one
// tag a rider can keep, rename or delete. It is a starting point, not a
// taxonomy — ADR-0015 says there is none.
func metadata(file io.ReadSeeker, filename string) (title, artist, album string, bpm *int16, tags []string) {
	fallback := strings.TrimSuffix(strings.TrimSpace(filename), ".mp3")
	tags = []string{}
	if m, err := tag.ReadFrom(file); err == nil {
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
		t := textx.Clip(strings.ToLower(strings.Join(strings.Fields(raw), " ")), maxTagRunes)
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

func clip(s string) string { return textx.Clip(strings.TrimSpace(s), maxTextRunes) }
