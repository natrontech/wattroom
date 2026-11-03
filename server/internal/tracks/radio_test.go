package tracks

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

func TestRadioServesARecordSignedInAndSeekable(t *testing.T) {
	dir := t.TempDir()
	record := make([]byte, 1000)
	if err := os.WriteFile(filepath.Join(dir, "still-life.mp3"), record, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(t.TempDir(), "secret.mp3"), record, 0o600); err != nil {
		t.Fatal(err)
	}
	users := &testx.Users{ByToken: map[string]db.User{"alice": {DisplayName: "alice"}}}
	mux := http.NewServeMux()
	(&Service{auth: users, log: slog.New(slog.DiscardHandler), radioDir: dir}).Register(mux)

	get := func(who, path, rng string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		if who != "" {
			req.Header.Set("X-Test-User", who)
		}
		if rng != "" {
			req.Header.Set("Range", rng)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		return w
	}
	for _, tc := range []struct {
		name, who, path, rng string
		want, bytes          int
	}{
		{"a record", "alice", "/api/radio/still-life.mp3", "", http.StatusOK, 1000},
		{"a second into it", "alice", "/api/radio/still-life.mp3", "bytes=100-199", http.StatusPartialContent, 100},
		{"signed out", "", "/api/radio/still-life.mp3", "", http.StatusUnauthorized, -1},
		{"not on the shelf", "alice", "/api/radio/missing.mp3", "", http.StatusNotFound, -1},
		{"out of the shelf", "alice", "/api/radio/..%2Fsecret.mp3", "", http.StatusNotFound, -1},
		{"not a record", "alice", "/api/radio/notes.txt", "", http.StatusNotFound, -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := get(tc.who, tc.path, tc.rng)
			if w.Code != tc.want {
				t.Fatalf("status = %d, want %d", w.Code, tc.want)
			}
			if tc.bytes >= 0 && w.Body.Len() != tc.bytes {
				t.Errorf("served %d bytes, want %d", w.Body.Len(), tc.bytes)
			}
			if tc.want < 300 && w.Header().Get("Content-Type") != "audio/mpeg" {
				t.Errorf("content-type = %q", w.Header().Get("Content-Type"))
			}
		})
	}
}
