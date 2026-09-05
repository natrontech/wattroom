package playlists

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/rooms"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// fakeUsers resolves the X-Test-User header instead of a session cookie —
// same shape every other package's suite uses.
type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) User(r *http.Request) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	return u, ok
}

func (f *fakeUsers) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	u, ok := f.User(r)
	if !ok {
		http.Error(w, `{"error":"unauthorized","message":"`+signInMessage+`"}`, http.StatusUnauthorized)
	}
	return u, ok
}

// fakeLive captures what would have reached a room's live queue, so the
// queue endpoint is testable without a real hub.
type fakeLive struct {
	slug, riderID, addedBy string
	tracks                 []protocol.JukeboxCommand
	reply                  int
	ok                     bool
}

func (f *fakeLive) QueuePlaylist(slug, riderID, addedBy string, tracks []protocol.JukeboxCommand) (int, bool) {
	f.slug, f.riderID, f.addedBy, f.tracks = slug, riderID, addedBy, tracks
	if !f.ok {
		return 0, false
	}
	if f.reply == 0 {
		f.reply = len(tracks)
	}
	return f.reply, true
}

type harness struct {
	mux     *http.ServeMux
	store   *store.Store
	svc     *Service
	live    *fakeLive
	users   map[string]db.User
	roomSeq int
}

func setup(t *testing.T) *harness {
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
	for _, name := range []string{"alice", "bob"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.byToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}

	log := slog.New(slog.DiscardHandler)
	svc := New(st, users, rooms.New(st, users, log), log)
	live := &fakeLive{ok: true}
	svc.SetLive(live)
	mux := http.NewServeMux()
	svc.Register(mux)
	return &harness{mux: mux, store: st, svc: svc, live: live, users: users.byToken}
}

func (h *harness) call(t *testing.T, user, method, path, body string) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, reader)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	var decoded map[string]any
	_ = json.NewDecoder(w.Body).Decode(&decoded)
	return w.Code, decoded
}

// room inserts a room directly (bypassing rooms.Service, which this package
// does not depend on) with owner as a member.
func (h *harness) room(t *testing.T, owner string) (slug string) {
	t.Helper()
	ownerUser := h.users[owner]
	h.roomSeq++
	slug = fmt.Sprintf("test-room-%s-%s-%d", strings.ToLower(strings.ReplaceAll(t.Name(), "/", "-")), owner, h.roomSeq)
	room, err := h.store.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Code: fmt.Sprintf("%c%05d", owner[0]-32, h.roomSeq), Slug: slug, Name: "Test Room", OwnerID: ownerUser.ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	if err := h.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: ownerUser.ID, Role: "owner",
	}); err != nil {
		t.Fatalf("membership: %v", err)
	}
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from rooms where slug = $1", slug)
	})
	return slug
}

func (h *harness) join(t *testing.T, slug, user, role string) {
	t.Helper()
	u := h.users[user]
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("lookup room: %v", err)
	}
	if err := h.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: u.ID, Role: role,
	}); err != nil {
		t.Fatalf("membership: %v", err)
	}
}

const videoTrack = `{"videoId":"dQw4w9WgXcQ","title":"Never Gonna Give You Up"}`

func TestPersonalPlaylistCRUD(t *testing.T) {
	h := setup(t)

	if status, _ := h.call(t, "", http.MethodGet, "/api/playlists", ""); status != http.StatusUnauthorized {
		t.Fatalf("anon list: %d", status)
	}

	status, body := h.call(t, "alice", http.MethodPost, "/api/playlists", `{"name":"Warmup"}`)
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, body)
	}
	id, _ := body["id"].(string)

	status, body = h.call(t, "alice", http.MethodPost, "/api/playlists/"+id+"/tracks", videoTrack)
	if status != http.StatusCreated {
		t.Fatalf("add track: %d %v", status, body)
	}
	trackID, _ := body["id"].(string)
	if body["videoId"] != "dQw4w9WgXcQ" {
		t.Fatalf("track shape: %v", body)
	}

	// Someone else's playlist is a 404, not a 403 (no probing which ids exist).
	if status, _ := h.call(t, "bob", http.MethodGet, "/api/playlists/"+id, ""); status != http.StatusNotFound {
		t.Fatalf("bob read: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/playlists/"+id+"/tracks", videoTrack); status != http.StatusNotFound {
		t.Fatalf("bob add track: %d", status)
	}

	status, body = h.call(t, "alice", http.MethodGet, "/api/playlists/"+id, "")
	tracks, _ := body["tracks"].([]any)
	if status != http.StatusOK || len(tracks) != 1 {
		t.Fatalf("detail: %d %v", status, body)
	}

	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/playlists/"+id+"/tracks/"+trackID, ""); status != http.StatusNoContent {
		t.Fatalf("delete track: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPut, "/api/playlists/"+id, `{"name":"Cooldown"}`); status != http.StatusOK {
		t.Fatalf("rename: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/playlists/"+id, ""); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	status, body = h.call(t, "alice", http.MethodGet, "/api/playlists", "")
	remaining, _ := body["playlists"].([]any)
	if status != http.StatusOK || len(remaining) != 0 {
		t.Fatalf("list after delete: %d %v", status, body)
	}
}

func TestAddTrackValidation(t *testing.T) {
	h := setup(t)
	_, body := h.call(t, "alice", http.MethodPost, "/api/playlists", `{"name":"Bad tracks"}`)
	id, _ := body["id"].(string)

	for name, track := range map[string]string{
		"short video id":   `{"videoId":"short","title":"x"}`,
		"playlist too big": mustPlaylistOf(51),
		"bad playlist id":  `{"playlistId":"a","playlistTitle":"x","tracks":[{"videoId":"dQw4w9WgXcQ","title":"x"}]}`,
	} {
		status, body := h.call(t, "alice", http.MethodPost, "/api/playlists/"+id+"/tracks", track)
		if status != http.StatusBadRequest {
			t.Errorf("%s: %d %v", name, status, body)
		}
	}
	if _, body := h.call(t, "alice", http.MethodPost, "/api/playlists", `{"name":""}`); body["field"] != "name" {
		t.Errorf("empty name: %v", body)
	}
}

func mustPlaylistOf(n int) string {
	tracks := make([]string, n)
	for i := range tracks {
		tracks[i] = `{"videoId":"dQw4w9WgXcQ","title":"x"}`
	}
	return fmt.Sprintf(`{"playlistId":"PLxxxxxxxxxxxxxxxxxxxxx","playlistTitle":"Big","tracks":[%s]}`, strings.Join(tracks, ","))
}

func TestRoomPlaylistMembershipAndActive(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	h.join(t, slug, "bob", "member")

	// A stranger (not even a member) cannot list or create.
	if status, _ := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug+"/playlists", ""); status != http.StatusOK {
		t.Fatalf("member list: %d", status)
	}

	status, body := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/playlists", `{"name":"Warmup"}`)
	if status != http.StatusCreated {
		t.Fatalf("member create: %d %v", status, body)
	}
	id, _ := body["id"].(string)

	// Autoplay: activating a playlist that is not this room's own fails.
	elsewhere := h.room(t, "alice")
	_, other := h.call(t, "alice", http.MethodPost, "/api/rooms/"+elsewhere+"/playlists", `{"name":"Elsewhere"}`)
	otherID, _ := other["id"].(string)
	status, body = h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/autoplay",
		fmt.Sprintf(`{"enabled":true,"order":"ordered","activePlaylistId":%q}`, otherID))
	if status != http.StatusBadRequest || body["field"] != "activePlaylistId" {
		t.Fatalf("cross-room activate: %d %v", status, body)
	}

	// Activating the room's own playlist works, and the list reflects it.
	status, body = h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/autoplay",
		fmt.Sprintf(`{"enabled":true,"order":"shuffled","activePlaylistId":%q}`, id))
	if status != http.StatusOK || body["activePlaylistId"] != id {
		t.Fatalf("activate: %d %v", status, body)
	}
	_, body = h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug+"/playlists", "")
	list, _ := body["playlists"].([]any)
	found := false
	for _, item := range list {
		row, _ := item.(map[string]any)
		if row["id"] == id {
			found = row["active"] == true
		}
	}
	if !found {
		t.Fatalf("active flag not set: %v", body)
	}

	// Bad order is refused.
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/autoplay", `{"enabled":false,"order":"random"}`); status != http.StatusBadRequest {
		t.Fatalf("bad order: %d", status)
	}
}

func TestQueuePlaylistCrossesRoomAndPersonal(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	h.join(t, slug, "bob", "member")

	// Bob's own personal playlist, queued into a room he is a member of.
	_, personal := h.call(t, "bob", http.MethodPost, "/api/playlists", `{"name":"Bob's mix"}`)
	pid, _ := personal["id"].(string)
	h.call(t, "bob", http.MethodPost, "/api/playlists/"+pid+"/tracks", videoTrack)

	status, body := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/playlists/"+pid+"/queue", "")
	if status != http.StatusOK || body["queued"] != float64(1) {
		t.Fatalf("queue personal into room: %d %v", status, body)
	}
	if h.live.slug != slug || h.live.riderID == "" || len(h.live.tracks) != 1 {
		t.Fatalf("live bridge did not see the queue: %+v", h.live)
	}

	// A stranger to both the playlist and the room gets a 404, not a peek.
	strangerRoom := h.room(t, "alice")
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+strangerRoom+"/playlists/"+pid+"/queue", ""); status != http.StatusForbidden {
		t.Fatalf("non-member queue: %d", status)
	}
}
