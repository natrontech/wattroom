package tracks

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"github.com/natrontech/wattroom/server/internal/httpx"
)

// radioFile is a record's name on house radio's shelf, as
// web/src/lib/lounge/records.json lists it.
var radioFile = regexp.MustCompile(`^[a-z0-9-]+\.mp3$`)

// handleRadio serves one of house radio's records: CC0 tracks every crew
// shares, placed in the image by the Dockerfile rather than uploaded
// (scripts/house-radio.py). Signed-in like the pool, and seekable, because
// every screen in a voice channel jumps to the same second of the record.
func (s *Service) handleRadio(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.me(w, r); !ok {
		return
	}
	name := r.PathValue("file")
	if !radioFile.MatchString(name) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That record is not on house radio.")
		return
	}
	f, err := os.Open(filepath.Join(s.radioDir, name)) //nolint:gosec // name checked against radioFile
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That record is not on house radio.")
		return
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		httpx.Fail(w, s.log, "radio stat", err, "That record could not be played.", "file", name)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("Content-Type", "audio/mpeg")
	http.ServeContent(w, r, name, info.ModTime(), f)
}
