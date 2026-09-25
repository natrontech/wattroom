package tracks

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/audio/audiotest"
)

// An upload is streamed to disk, not read into memory (#2862): six parallel
// 48 MB bodies were six 48 MB slices, plus the growth copies io.ReadAll makes,
// on the VM Postgres shares. What one request allocates is now a copy buffer
// and a frame at a time, whatever the size of the track.
func TestAnUploadIsNotHeldInMemory(t *testing.T) {
	h := setup(t)
	data := append(audiotest.MP3(40_000, 14, 0), 0x2a) // ~40 MB at 320 kbps
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/tracks?name=Long.mp3", bytes.NewReader(data))
	req.Header.Set("X-Test-User", "alice")
	w := httptest.NewRecorder()

	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	h.mux.ServeHTTP(w, req)
	runtime.ReadMemStats(&after)

	if w.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	if allocated := after.TotalAlloc - before.TotalAlloc; allocated > uint64(len(data))/4 {
		t.Fatalf("a %d MB upload allocated %d MB — the body was buffered", len(data)>>20, allocated>>20)
	}
}

// One upload per rider at a time (#2862): the second waits for the first
// rather than running beside it, and it is told so as the 429 it is.
func TestASecondUploadWaitsForTheFirst(t *testing.T) {
	h := setup(t)
	alice := h.users.ByToken["alice"].ID
	if !h.svc.uploading.Acquire(alice) {
		t.Fatal("the fixture could not stand in for an upload in flight")
	}
	w := h.do(t, "alice", http.MethodPost, "/api/tracks?name=Next.mp3", song(40, 383))
	if w.Code != http.StatusTooManyRequests || decode(t, w)["error"] != "rate_limited" {
		t.Fatalf("second upload = %d %s, want 429 rate_limited", w.Code, w.Body.String())
	}
	// Somebody else's upload is not in the way.
	h.upload(t, "bob", song(41, 383), "Bob.mp3")

	h.svc.uploading.Release(alice)
	h.upload(t, "alice", song(40, 383), "Next.mp3")
	if h.svc.uploading.Running(alice) {
		t.Fatal("a finished upload kept its slot")
	}
}

// Whatever becomes of an upload, nothing half-received is left in the store:
// the file is renamed to its address, or it is removed.
func TestNoUploadLeavesItsTemporaryFileBehind(t *testing.T) {
	h := setup(t)
	h.upload(t, "alice", song(42, 383), "Kept.mp3")
	for _, body := range [][]byte{
		audiotest.ID3(1 << 20)[:4096],                                   // a tag longer than the file: not measurable
		bytes.Repeat([]byte{0xFF, 0xFB, 0x90, 0}, (maxUploadBytes/4)+1), // over the cap
	} {
		if w := h.do(t, "alice", http.MethodPost, "/api/tracks?name=x.mp3", body); w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400: %s", w.Code, w.Body.String())
		}
	}
	entries, err := os.ReadDir(h.dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".upload-") {
			t.Errorf("%s was left in the store", e.Name())
		}
	}
}
