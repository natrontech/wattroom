package board

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	if !ok {
		http.Error(w, `{"error":"unauthorized","message":"`+signInMessage+`"}`, http.StatusUnauthorized)
	}
	return u, ok
}

// fakeRooms stands in for the hub: who is in which room this instant.
type fakeRooms struct{ at map[string]string }

func (f *fakeRooms) WhereIs(ids []string) map[string]string {
	out := map[string]string{}
	for _, id := range ids {
		if slug, ok := f.at[id]; ok {
			out[id] = slug
		}
	}
	return out
}

func setup(t *testing.T) (*http.ServeMux, *fakeUsers, *fakeRooms) {
	t.Helper()
	dsn := os.Getenv("WATTROOM_TEST_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials — NEVER the dev db, tests delete users
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	t.Cleanup(st.Close)

	users := &fakeUsers{byToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "cara"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.byToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}
	rooms := &fakeRooms{at: map[string]string{}}
	mux := http.NewServeMux()
	New(st, users, rooms, slog.New(slog.DiscardHandler)).Register(mux)
	return mux, users, rooms
}

func do(t *testing.T, mux *http.ServeMux, who, method, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewReader(body))
	if who != "" {
		req.Header.Set("X-Test-User", who)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func upload(t *testing.T, mux *http.ServeMux, who, name string, data []byte) clipJSON {
	t.Helper()
	rec := do(t, mux, who, "POST", "/api/board/clips?name="+name, data)
	if rec.Code != http.StatusOK {
		t.Fatalf("upload %s: %d %s", name, rec.Code, rec.Body)
	}
	var clip clipJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &clip); err != nil {
		t.Fatalf("decode clip: %v", err)
	}
	return clip
}

// tenSeconds is a real MPEG 1 Layer III file: 383 silent frames at 128 kbps.
func tenSeconds() []byte { return mp3(383, 9, 0) }

func TestUploadAndList(t *testing.T) {
	mux, _, _ := setup(t)
	clip := upload(t, mux, "alice", "AIRHORN", tenSeconds())
	if clip.Millis != 10004 || clip.Bytes != len(tenSeconds()) {
		t.Fatalf("clip = %+v; want 10004 ms and %d bytes", clip, len(tenSeconds()))
	}

	rec := do(t, mux, "alice", "GET", "/api/board/clips", nil)
	var list listJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list.Clips) != 1 || list.Clips[0].Name != "AIRHORN" {
		t.Fatalf("clips = %+v; want one AIRHORN", list.Clips)
	}
	if list.Used != int64(len(tenSeconds())) || list.Limit != MaxRiderBytes {
		t.Errorf("used/limit = %d/%d; want %d/%d", list.Used, list.Limit, len(tenSeconds()), int64(MaxRiderBytes))
	}
	// A board is one rider's: bob sees none of alice's.
	rec = do(t, mux, "bob", "GET", "/api/board/clips", nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Clips) != 0 {
		t.Errorf("bob sees %d of alice's clips; want 0", len(list.Clips))
	}
}

func TestUploadRefusals(t *testing.T) {
	mux, _, _ := setup(t)
	tests := []struct {
		name string
		who  string
		path string
		body []byte
		want int
	}{
		{"signed out", "", "/api/board/clips?name=X", tenSeconds(), http.StatusUnauthorized},
		{"no name", "alice", "/api/board/clips", tenSeconds(), http.StatusBadRequest},
		{"name too long", "alice", "/api/board/clips?name=" + string(bytes.Repeat([]byte("a"), 33)), tenSeconds(), http.StatusBadRequest},
		{"not an mp3", "alice", "/api/board/clips?name=X", []byte("PNG, honestly"), http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if rec := do(t, mux, tt.who, "POST", tt.path, tt.body); rec.Code != tt.want {
				t.Errorf("status = %d; want %d (%s)", rec.Code, tt.want, rec.Body)
			}
		})
	}
}

func TestPadAssignmentBumpsWhatWasThere(t *testing.T) {
	mux, _, _ := setup(t)
	horn := upload(t, mux, "alice", "AIRHORN", tenSeconds())
	bell := upload(t, mux, "alice", "COWBELL", tenSeconds())

	for _, id := range []string{horn.ID, bell.ID} {
		if rec := do(t, mux, "alice", "PUT", "/api/board/clips/"+id+"/pad", []byte(`{"pad":1}`)); rec.Code != http.StatusNoContent {
			t.Fatalf("set pad: %d %s", rec.Code, rec.Body)
		}
	}
	rec := do(t, mux, "alice", "GET", "/api/board/clips", nil)
	var list listJSON
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	for _, clip := range list.Clips {
		switch {
		case clip.Name == "COWBELL" && (clip.Pad == nil || *clip.Pad != 1):
			t.Errorf("COWBELL pad = %v; want 1", clip.Pad)
		case clip.Name == "AIRHORN" && clip.Pad != nil:
			t.Errorf("AIRHORN pad = %v; want none — it was bumped to the library", *clip.Pad)
		}
	}
}

func TestPadRefusals(t *testing.T) {
	mux, _, _ := setup(t)
	clip := upload(t, mux, "alice", "AIRHORN", tenSeconds())
	tests := []struct {
		name, who, id string
		body          string
		want          int
	}{
		{"signed out", "", clip.ID, `{"pad":1}`, http.StatusUnauthorized},
		{"pad zero", "alice", clip.ID, `{"pad":0}`, http.StatusBadRequest},
		{"pad past the board", "alice", clip.ID, `{"pad":10}`, http.StatusBadRequest},
		{"not a pad at all", "alice", clip.ID, `{"pad":"one"}`, http.StatusBadRequest},
		{"somebody else's clip", "bob", clip.ID, `{"pad":1}`, http.StatusNotFound},
		{"no such clip", "alice", "not-a-uuid", `{"pad":1}`, http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(t, mux, tt.who, "PUT", "/api/board/clips/"+tt.id+"/pad", []byte(tt.body))
			if rec.Code != tt.want {
				t.Errorf("status = %d; want %d (%s)", rec.Code, tt.want, rec.Body)
			}
		})
	}
}

func TestDelete(t *testing.T) {
	mux, _, _ := setup(t)
	clip := upload(t, mux, "alice", "AIRHORN", tenSeconds())
	if rec := do(t, mux, "bob", "DELETE", "/api/board/clips/"+clip.ID, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("bob deleting alice's clip = %d; want 404", rec.Code)
	}
	if rec := do(t, mux, "alice", "DELETE", "/api/board/clips/"+clip.ID, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d; want 204", rec.Code)
	}
	if rec := do(t, mux, "alice", "DELETE", "/api/board/clips/"+clip.ID, nil); rec.Code != http.StatusNotFound {
		t.Errorf("deleting twice = %d; want 404", rec.Code)
	}
}

// The gate ADR-0033 describes: your own clips anywhere, somebody else's only
// while you are in a room with them this instant.
func TestAudioIsGatedOnSharingARoom(t *testing.T) {
	mux, users, rooms := setup(t)
	clip := upload(t, mux, "alice", "AIRHORN", tenSeconds())
	alice := store.UUIDString(users.byToken["alice"].ID)
	bob := store.UUIDString(users.byToken["bob"].ID)
	cara := store.UUIDString(users.byToken["cara"].ID)

	if rec := do(t, mux, "alice", "GET", "/api/board/clips/"+clip.ID+"/audio", nil); rec.Code != http.StatusOK {
		t.Fatalf("owner = %d; want 200", rec.Code)
	}
	if rec := do(t, mux, "bob", "GET", "/api/board/clips/"+clip.ID+"/audio", nil); rec.Code != http.StatusNotFound {
		t.Errorf("a rider in no room = %d; want 404", rec.Code)
	}

	// Signed in at the same time is not being in a room together.
	rooms.at = map[string]string{alice: "", bob: ""}
	if rec := do(t, mux, "bob", "GET", "/api/board/clips/"+clip.ID+"/audio", nil); rec.Code != http.StatusNotFound {
		t.Errorf("both in the lobby = %d; want 404", rec.Code)
	}

	rooms.at = map[string]string{alice: "threshold", bob: "threshold", cara: "backyard"}
	rec := do(t, mux, "bob", "GET", "/api/board/clips/"+clip.ID+"/audio", nil)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), tenSeconds()) {
		t.Errorf("same room = %d with %d bytes; want 200 with the clip", rec.Code, rec.Body.Len())
	}
	if got := rec.Header().Get("Content-Type"); got != "audio/mpeg" {
		t.Errorf("content type = %q; want audio/mpeg", got)
	}
	if rec := do(t, mux, "cara", "GET", "/api/board/clips/"+clip.ID+"/audio", nil); rec.Code != http.StatusNotFound {
		t.Errorf("another room = %d; want 404", rec.Code)
	}
	if rec := do(t, mux, "", "GET", "/api/board/clips/"+clip.ID+"/audio", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("signed out = %d; want 401", rec.Code)
	}
}

// A source longer than the ceiling is accepted and lands already trimmed to
// it: the rider opens the editor to choose WHICH minute, and until they do the
// clip can still never play past SPEC's minute (#934).
func TestLongUploadArrivesTrimmedToTheCeiling(t *testing.T) {
	mux, _, _ := setup(t)
	long := mp3(2400, 9, 0) // ~62.7 s
	if ms, ok := DurationMillis(long); !ok || ms <= MaxClipMillis {
		t.Fatalf("test fixture is not longer than the ceiling: %d ms", ms)
	}
	clip := upload(t, mux, "alice", "LONG", long)
	if clip.EndMillis != MaxClipMillis || clip.StartMillis != 0 {
		t.Errorf("kept span = %d..%d; want 0..%d", clip.StartMillis, clip.EndMillis, MaxClipMillis)
	}

	rec := do(t, mux, "alice", "GET", "/api/board/clips", nil)
	var list listJSON
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Clips) != 1 || list.Clips[0].EndMillis != MaxClipMillis {
		t.Errorf("listed edit = %+v; want end at the ceiling", list.Clips)
	}
}

func TestEditRules(t *testing.T) {
	// 10 s of source, so every bound below is a real one.
	source := 10004
	tests := []struct {
		name  string
		edit  editJSON
		field string
	}{
		{"the whole source", editJSON{}, ""},
		{"a trim inside it", editJSON{StartMillis: 1000, EndMillis: 4000}, ""},
		{"fades that fit", editJSON{EndMillis: 4000, FadeInMs: 100, FadeOutMs: 300}, ""},
		{"gain at the limit", editJSON{GainDb: MaxGainDb}, ""},
		{"a start past the end of the audio", editJSON{StartMillis: source}, "startMs"},
		{"a negative start", editJSON{StartMillis: -1}, "startMs"},
		{"an end before the start", editJSON{StartMillis: 5000, EndMillis: 4000}, "endMs"},
		{"fades longer than what they fade", editJSON{EndMillis: 1000, FadeInMs: 600, FadeOutMs: 600}, "fadeInMs"},
		{"a negative fade", editJSON{FadeInMs: -1}, "fadeInMs"},
		{"gain past the limit", editJSON{GainDb: MaxGainDb + 0.1}, "gainDb"},
		{"gain past the limit downward", editJSON{GainDb: -MaxGainDb - 0.1}, "gainDb"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, field := checkEdit(tt.edit, source)
			if field != tt.field {
				t.Errorf("field = %q (%q); want %q", field, msg, tt.field)
			}
			if (msg == "") != (tt.field == "") {
				t.Errorf("message %q disagrees with field %q", msg, field)
			}
		})
	}
}

// A minute of a longer source is fine; a minute and a bit is not, whatever the
// source's own length.
func TestEditCannotKeepMoreThanTheCeiling(t *testing.T) {
	source := 5 * 60 * 1000
	if _, field := checkEdit(editJSON{EndMillis: MaxClipMillis}, source); field != "" {
		t.Errorf("exactly the ceiling was refused (%s)", field)
	}
	if _, field := checkEdit(editJSON{EndMillis: MaxClipMillis + 1}, source); field != "endMs" {
		t.Errorf("a clip past the ceiling was allowed; field = %q", field)
	}
}

func TestEditEndpoint(t *testing.T) {
	mux, _, _ := setup(t)
	clip := upload(t, mux, "alice", "AIRHORN", tenSeconds())
	body := []byte(`{"startMs":500,"endMs":3000,"gainDb":2.5,"fadeInMs":50,"fadeOutMs":300}`)

	if rec := do(t, mux, "bob", "PUT", "/api/board/clips/"+clip.ID+"/edit", body); rec.Code != http.StatusNotFound {
		t.Errorf("bob editing alice's clip = %d; want 404", rec.Code)
	}
	if rec := do(t, mux, "", "PUT", "/api/board/clips/"+clip.ID+"/edit", body); rec.Code != http.StatusUnauthorized {
		t.Errorf("signed out = %d; want 401", rec.Code)
	}
	if rec := do(t, mux, "alice", "PUT", "/api/board/clips/"+clip.ID+"/edit", []byte(`{"startMs":99999}`)); rec.Code != http.StatusBadRequest {
		t.Errorf("a start past the audio = %d; want 400", rec.Code)
	}
	if rec := do(t, mux, "alice", "PUT", "/api/board/clips/"+clip.ID+"/edit", body); rec.Code != http.StatusNoContent {
		t.Fatalf("edit = %d; want 204", rec.Code)
	}

	rec := do(t, mux, "alice", "GET", "/api/board/clips", nil)
	var list listJSON
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	got := list.Clips[0]
	if got.StartMillis != 500 || got.EndMillis != 3000 || got.GainDb != 2.5 ||
		got.FadeInMs != 50 || got.FadeOutMs != 300 {
		t.Errorf("stored edit = %+v; want the one just saved", got.editJSON)
	}
	// The source is untouched: an edit is numbers, never a re-encode.
	if got.Millis != 10004 || got.Bytes != len(tenSeconds()) {
		t.Errorf("source changed: %d ms / %d bytes", got.Millis, got.Bytes)
	}
}
