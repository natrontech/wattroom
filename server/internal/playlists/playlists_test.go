package playlists

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/channels"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// fakeLive captures what would have reached a voice channel's live deck, so
// the queue endpoints are testable without a real hub.
type fakeLive struct {
	channel, riderID, addedBy string
	tracks                    []protocol.JukeboxCommand
	reply                     int
	ok                        bool
}

func (f *fakeLive) QueuePlaylist(channel, riderID, addedBy string, tracks []protocol.JukeboxCommand) (int, bool) {
	f.channel, f.riderID, f.addedBy, f.tracks = channel, riderID, addedBy, tracks
	if !f.ok {
		return 0, false
	}
	if f.reply == 0 {
		f.reply = len(tracks)
	}
	return f.reply, true
}

type harness struct {
	mux   *http.ServeMux
	store *store.Store
	svc   *Service
	live  *fakeLive
	users map[string]db.User
}

func setup(t *testing.T) *harness {
	t.Helper()
	st := storetest.Open(t)

	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "carol"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.ByToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}

	log := slog.New(slog.DiscardHandler)
	gate := channels.New(st, users, log)
	svc := New(st, users, gate, log)
	live := &fakeLive{ok: true}
	svc.SetLive(live)
	mux := http.NewServeMux()
	svc.Register(mux)
	// The channel's own routes beside these, as main.go mounts them: a voice
	// channel's autoplay is set by its PATCH (#2434) and read by Autoplay here.
	gate.Register(mux)
	return &harness{mux: mux, store: st, svc: svc, live: live, users: users.ByToken}
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

// crewFixture is a crew as ADR-0058's migration left every room: its owner's,
// with one text and one voice channel, both private — so a member reaches
// them only once named in (join).
type crewFixture struct {
	id, textID, voiceID pgtype.UUID
}

// voice is the voice channel as the hub names it — what it hands autoplay,
// the history and the live bridge.
func (c crewFixture) voice() string { return store.UUIDString(c.voiceID) }

// crew founds a crew owned by owner, straight through the store.
func (h *harness) crew(t *testing.T, owner string) crewFixture {
	t.Helper()
	crew, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{
		Name: "Test Crew", OwnerID: h.users[owner].ID, Code: testx.CrewCode(),
	})
	if err != nil {
		t.Fatalf("create crew: %v", err)
	}
	// Registered after setup's users, so it runs before them: crews.owner_id
	// is RESTRICT. The channels, the shelf and the play log cascade with it.
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID)
	})
	return crewFixture{
		id:      crew.ID,
		textID:  h.channel(t, crew.ID, "text", true),
		voiceID: h.channel(t, crew.ID, "voice", true),
	}
}

// channel adds one channel of kind to crew.
func (h *harness) channel(t *testing.T, crew pgtype.UUID, kind string, private bool) pgtype.UUID {
	t.Helper()
	var limit int32 = protocol.MaxCrewVoiceChannels
	if kind == "text" {
		limit = protocol.MaxCrewTextChannels
	}
	c, err := h.store.Queries.CreateChannel(t.Context(), db.CreateChannelParams{
		CrewID: crew, Kind: kind, Name: kind, Private: private, MaxChannels: limit,
	})
	if err != nil {
		t.Fatalf("create %s channel: %v", kind, err)
	}
	return c.ID
}

// join puts user in the crew as role — member, admin or banned — and names
// anyone the crew has not banned into both of its private channels, as the
// migration carried a room's members over. A ban names them into nothing.
func (h *harness) join(t *testing.T, c crewFixture, user, role string) {
	t.Helper()
	u := h.users[user]
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: c.id, UserID: u.ID, Role: role,
	}); err != nil {
		t.Fatalf("crew role: %v", err)
	}
	if role == "banned" {
		return
	}
	for _, channel := range []pgtype.UUID{c.textID, c.voiceID} {
		if err := h.store.Queries.NameChannelMember(t.Context(), db.NameChannelMemberParams{
			ChannelID: channel, UserID: u.ID,
		}); err != nil {
			t.Fatalf("name into a channel: %v", err)
		}
	}
}

// autoplay sets the voice channel's autoplay through the channel's own PATCH
// (#2434) as alice, who owns every crew a test sets it on.
func (h *harness) autoplay(t *testing.T, c crewFixture, settings string) {
	t.Helper()
	if status, body := h.call(t, "alice", http.MethodPatch, "/api/channels/"+c.voice(), `{"autoplay":`+settings+`}`); status != http.StatusOK {
		t.Fatalf("set autoplay %s: %d %v", settings, status, body)
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

// A rider's own playlist queues into any voice channel they may enter (#627,
// #2439): the shelf is theirs, the deck is the channel's.
func TestQueueAPersonalPlaylistIntoAChannel(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")
	h.join(t, c, "bob", "member")

	_, personal := h.call(t, "bob", http.MethodPost, "/api/playlists", `{"name":"Bob's mix"}`)
	pid, _ := personal["id"].(string)
	h.call(t, "bob", http.MethodPost, "/api/playlists/"+pid+"/tracks", videoTrack)

	status, body := h.call(t, "bob", http.MethodPost, "/api/channels/"+c.voice()+"/playlists/"+pid+"/queue", "")
	if status != http.StatusOK || body["queued"] != float64(1) {
		t.Fatalf("queue personal into the channel: %d %v", status, body)
	}
	if h.live.channel != c.voice() || h.live.riderID == "" || len(h.live.tracks) != 1 {
		t.Fatalf("live bridge did not see the queue: %+v", h.live)
	}

	// Somebody else's own playlist is not on this shelf, even for the crew's
	// owner — a 404, not a peek.
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/channels/"+c.voice()+"/playlists/"+pid+"/queue", ""); status != http.StatusNotFound {
		t.Fatalf("queue another rider's playlist: %d, want 404", status)
	}
	// A channel of a crew he is not in is not there for him, his playlist or not.
	stranger := h.crew(t, "alice")
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/channels/"+stranger.voice()+"/playlists/"+pid+"/queue", ""); status != http.StatusNotFound {
		t.Fatalf("queue into a stranger crew's channel: %d, want 404", status)
	}
}
