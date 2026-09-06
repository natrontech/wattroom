package rides

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/muktihari/fit/decoder"
	"github.com/muktihari/fit/profile/filedef"
	"github.com/natrontech/wattroom/server/internal/store"
)

func exportRequest(t *testing.T, h *harness, user, id string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rides/"+id+"/export", nil)
	if user != "" {
		r.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, r)
	return w
}

func TestExportOwnerGetsValidFIT(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	w := exportRequest(t, h, "alice", id)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Content-Type"); got != "application/vnd.ant.fit" {
		t.Fatalf("content type = %q", got)
	}
	data, err := io.ReadAll(w.Body)
	if err != nil {
		t.Fatal(err)
	}
	fit, err := decoder.New(bytes.NewReader(data)).Decode()
	if err != nil {
		t.Fatalf("decode FIT: %v", err)
	}
	records := filedef.NewActivity(fit.Messages...).Records
	if len(records) != 120 || records[0].Power != 200 || records[0].Cadence != 90 {
		t.Fatalf("records = %d, first = %+v", len(records), records[0])
	}
}

func TestExportAuthorizationAndIDs(t *testing.T) {
	h := setup(t)
	id := h.save(t, "alice", 120, 200)
	if w := exportRequest(t, h, "", id); w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous = %d", w.Code)
	}
	if w := exportRequest(t, h, "bob", id); w.Code != http.StatusNotFound {
		t.Errorf("other user = %d", w.Code)
	}
	for _, tc := range []struct {
		name, id string
		want     int
	}{{"invalid", "nope", 400}, {"missing", "00000000-0000-0000-0000-000000000000", 404}} {
		t.Run(tc.name, func(t *testing.T) {
			if w := exportRequest(t, h, "alice", tc.id); w.Code != tc.want {
				t.Errorf("status = %d, want %d", w.Code, tc.want)
			}
		})
	}
}

func TestExportEmptyAndCorruptSamples(t *testing.T) {
	h := setup(t)
	for _, tc := range []struct {
		name string
		blob []byte
		want int
	}{{"empty", []byte{}, 404}, {"corrupt", []byte("not samples"), 500}} {
		t.Run(tc.name, func(t *testing.T) {
			id := h.save(t, "alice", 120, 200)
			uid, _ := store.ParseUUID(id)
			if _, err := h.store.Pool.Exec(t.Context(), "update rides set samples = $1 where id = $2", tc.blob, uid); err != nil {
				t.Fatal(err)
			}
			if w := exportRequest(t, h, "alice", id); w.Code != tc.want {
				t.Errorf("status = %d, want %d", w.Code, tc.want)
			}
		})
	}
}
