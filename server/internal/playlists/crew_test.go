package playlists

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The crew's shelf and a voice channel's deck (ADR-0058, #2439).

// crewOf is the crew the fixture room is in, with its channels made.
func (h *harness) crewOf(t *testing.T, slug string) pgtype.UUID {
	t.Helper()
	h.voice(t, slug)
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	return room.CrewID
}

// secondVoice is another open voice channel of the same crew.
func (h *harness) secondVoice(t *testing.T, crew pgtype.UUID) string {
	t.Helper()
	var id pgtype.UUID
	if err := h.store.Pool.QueryRow(t.Context(),
		`insert into channels (crew_id, kind, name, position, private) values ($1, 'voice', 'Second', 1, false) returning id`,
		crew).Scan(&id); err != nil {
		t.Fatalf("second voice channel: %v", err)
	}
	return store.UUIDString(id)
}

// crewPlaylist saves a crew playlist holding two videos, as who.
func (h *harness) crewPlaylist(t *testing.T, crew pgtype.UUID, who string) string {
	t.Helper()
	base := "/api/crews/" + store.UUIDString(crew) + "/playlists"
	status, body := h.call(t, who, http.MethodPost, base, `{"name":"Warm-up"}`)
	if status != http.StatusCreated {
		t.Fatalf("create crew playlist: %d %v", status, body)
	}
	id, _ := body["id"].(string)
	for _, track := range []string{
		`{"videoId":"dQw4w9WgXcQ","title":"Track 1"}`,
		`{"videoId":"9bZkp7q19f0","title":"Track 2"}`,
	} {
		if status, body := h.call(t, who, http.MethodPost, base+"/"+id+"/tracks", track); status != http.StatusCreated {
			t.Fatalf("add track: %d %v", status, body)
		}
	}
	return id
}

// docs/SPEC.md's rows: every member creates, adds and reorders; the owner and
// admins rename, delete and drop a track. Outsiders see no shelf at all.
func TestCrewPlaylistsFollowTheRolesMatrix(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	crew := h.crewOf(t, slug)
	if err := h.store.Queries.JoinCrew(t.Context(), db.JoinCrewParams{CrewID: crew, UserID: h.users["bob"].ID}); err != nil {
		t.Fatalf("join: %v", err)
	}
	base := "/api/crews/" + store.UUIDString(crew) + "/playlists"

	status, body := h.call(t, "bob", http.MethodPost, base, `{"name":"Bob's mix"}`)
	if status != http.StatusCreated {
		t.Fatalf("a member creating a crew playlist: %d %v", status, body)
	}
	id, _ := body["id"].(string)
	if status, _ := h.call(t, "bob", http.MethodPost, base+"/"+id+"/tracks", videoTrack); status != http.StatusCreated {
		t.Errorf("a member adding a track: %d, want 201", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPut, base+"/"+id, `{"name":"Mine"}`); status != http.StatusForbidden {
		t.Errorf("a member renaming a crew playlist: %d, want 403", status)
	}
	if status, _ := h.call(t, "bob", http.MethodDelete, base+"/"+id, ""); status != http.StatusForbidden {
		t.Errorf("a member deleting a crew playlist: %d, want 403", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPut, base+"/"+id, `{"name":"Crew mix"}`); status != http.StatusOK {
		t.Errorf("the owner renaming it: %d, want 200", status)
	}
	if status, _ := h.call(t, "carol", http.MethodGet, base, ""); status != http.StatusNotFound {
		t.Errorf("an outsider reading the shelf: %d, want 404", status)
	}
	if status, _ := h.call(t, "", http.MethodGet, base, ""); status != http.StatusUnauthorized {
		t.Errorf("signed out: %d, want 401", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, base, `{"name":""}`); status != http.StatusBadRequest {
		t.Errorf("an empty name: %d, want 400", status)
	}
	// The room's page reads the same shelf until the room goes (#2446).
	_, list := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug+"/playlists", "")
	rows, _ := list["playlists"].([]any)
	if len(rows) != 1 {
		t.Errorf("the room's list shows %d playlists, want the crew's one", len(rows))
	}
}

// channelAccess admits whoever the X-Rider header names, to any channel —
// the playlists package's queue door is what is under test, not the hub's.
type channelAccess struct{}

func (channelAccess) Authorize(r *http.Request, channel string) (protocol.Rider, string, error) {
	id := r.Header.Get("X-Rider")
	if id == "" {
		return protocol.Rider{}, "", av.ErrNotMember
	}
	return protocol.Rider{ID: id, Name: id, Role: "member"}, channel, nil
}

// occupy opens a socket onto channel so its deck is live, and returns it.
func occupy(t *testing.T, srv *httptest.Server, channel string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/" + channel
	conn, res, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: http.Header{"X-Rider": []string{"alice"}}})
	if res != nil && res.Body != nil {
		_ = res.Body.Close()
	}
	if err != nil {
		t.Fatalf("occupy %s: %v", channel, err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	// The handshake finishing is not the hub holding the socket: the join
	// runs after the upgrade, and the socket's own Connection frame is sent
	// before it. A tick reaches only the sockets the channel's room holds, so
	// the first one is the proof — a POST sent before it can find the channel
	// empty and draw the 409 the test asserts elsewhere (#2490).
	for {
		var msg protocol.ServerMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			t.Fatalf("occupy %s: no tick: %v", channel, err)
		}
		if msg.Tick != nil {
			return conn
		}
	}
}

// deckOf reads ticks until the channel's deck is playing, and returns it.
func deckOf(t *testing.T, conn *websocket.Conn) protocol.JukeboxState {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
		var msg protocol.ServerMessage
		err := wsjson.Read(ctx, conn, &msg)
		cancel()
		if err != nil {
			t.Fatalf("read tick: %v", err)
		}
		if msg.Tick != nil && msg.Tick.Jukebox.Current != nil {
			return msg.Tick.Jukebox
		}
	}
	t.Fatal("the deck never started")
	return protocol.JukeboxState{}
}

// One crew playlist queued into two voice channels plays in each on its own
// (#2439's bar): each channel is its own deck, so the second queue neither
// lands on the first deck nor doubles it.
func TestOnePlaylistQueuedIntoTwoChannelsPlaysInEach(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	crew := h.crewOf(t, slug)
	first := h.voice(t, slug)
	second := h.secondVoice(t, crew)
	playlist := h.crewPlaylist(t, crew, "alice")

	live := hub.New(slog.New(slog.DiscardHandler), channelAccess{}, nil)
	h.svc.SetLive(live)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", live.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	// Nobody in a channel: its deck is not live, and the refusal says so.
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/channels/"+first+"/playlists/"+playlist+"/queue", ""); status != http.StatusConflict {
		t.Fatalf("queue into an empty channel: %d, want 409", status)
	}
	decks := map[string]*websocket.Conn{first: occupy(t, srv, first), second: occupy(t, srv, second)}
	for channel := range decks {
		status, body := h.call(t, "alice", http.MethodPost, "/api/channels/"+channel+"/playlists/"+playlist+"/queue", "")
		if status != http.StatusOK || body["queued"] != float64(2) {
			t.Fatalf("queue into %s: %d %v", channel, status, body)
		}
	}
	for channel, conn := range decks {
		deck := deckOf(t, conn)
		if deck.Current.VideoID != "dQw4w9WgXcQ" || len(deck.Queue) != 1 || deck.Queue[0].VideoID != "9bZkp7q19f0" {
			t.Errorf("channel %s's deck: playing %s, queue %+v — want its own copy of the playlist", channel[:8], deck.Current.VideoID, deck.Queue)
		}
	}
}

// "Just played" is the channel's own (ADR-0058): what one deck played is not
// a fact about the crew's other channels.
func TestJustPlayedIsPerChannel(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	first := h.voice(t, slug)
	second := h.secondVoice(t, h.crewOf(t, slug))

	h.svc.TrackEnded(t.Context(), first, hub.Play{VideoID: "dQw4w9WgXcQ", Title: "Never Gonna Give You Up"})
	if got := h.svc.Recent(t.Context(), first, 5); len(got) != 1 {
		t.Fatalf("the channel that played it remembers %d plays, want 1", len(got))
	}
	if got := h.svc.Recent(t.Context(), second, 5); len(got) != 0 {
		t.Errorf("the other channel remembers %+v, want nothing", got)
	}
}

// The queue door is the voice channel's: a text channel has no deck, an
// outsider may not enter, and another crew's playlist is not on this shelf.
func TestTheChannelQueueDoor(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	crew := h.crewOf(t, slug)
	voice := h.voice(t, slug)
	playlist := h.crewPlaylist(t, crew, "alice")
	var text string
	if err := h.store.Pool.QueryRow(t.Context(),
		`select text_channel_id::text from room_channels rc join rooms r on r.id = rc.room_id where r.slug = $1`, slug).Scan(&text); err != nil {
		t.Fatalf("text channel: %v", err)
	}
	other := h.room(t, "bob")
	foreign := h.crewPlaylist(t, h.crewOf(t, other), "bob")

	for _, c := range []struct {
		who, path string
		want      int
	}{
		{"", "/api/channels/" + voice + "/playlists/" + playlist + "/queue", http.StatusUnauthorized},
		{"carol", "/api/channels/" + voice + "/playlists/" + playlist + "/queue", http.StatusNotFound},
		{"alice", "/api/channels/" + text + "/playlists/" + playlist + "/queue", http.StatusNotFound},
		{"alice", "/api/channels/" + voice + "/playlists/" + foreign + "/queue", http.StatusNotFound},
		{"alice", "/api/channels/" + voice + "/queue", http.StatusBadRequest},
	} {
		body := ""
		if strings.HasSuffix(c.path, "/queue") && !strings.Contains(c.path, "/playlists/") {
			body = `{"trackIds":[]}`
		}
		if status, got := h.call(t, c.who, http.MethodPost, c.path, body); status != c.want {
			t.Errorf("%q POST %s = %d %v, want %d", c.who, c.path, status, got, c.want)
		}
	}
}

// The room's autoplay settings write its voice channel's (#2439), which is
// what the worker reads — a room page and a channel page cannot disagree.
func TestTheRoomsAutoplayIsItsVoiceChannels(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	playlist := h.crewPlaylist(t, h.crewOf(t, slug), "alice")
	voice := h.voice(t, slug)

	if _, ok := h.svc.Autoplay(t.Context(), voice, hub.SessionMood{}); ok {
		t.Fatal("autoplay played before anyone turned it on")
	}
	body := fmt.Sprintf(`{"enabled":true,"order":"ordered","activePlaylistId":%q}`, playlist)
	if status, got := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/autoplay", body); status != http.StatusOK {
		t.Fatalf("room autoplay: %d %v", status, got)
	}
	tracks, ok := h.svc.Autoplay(t.Context(), voice, hub.SessionMood{})
	if !ok || len(tracks) != 2 || tracks[0].VideoID != "dQw4w9WgXcQ" {
		t.Errorf("the channel's autoplay = %v %+v, want the crew playlist in order", ok, tracks)
	}
}
