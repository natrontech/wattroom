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

// secondVoice is another open voice channel of the same crew.
func (h *harness) secondVoice(t *testing.T, crew pgtype.UUID) string {
	t.Helper()
	return store.UUIDString(h.channel(t, crew, "voice", false))
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
	crew := h.crew(t, "alice").id
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
}

// #695's line, on the crew's shelf: a member puts on it, but what takes from
// it — renaming, deleting, dropping a track — is the owner's and the admins'
// (docs/SPEC.md), since it tears down what every member relies on.
func TestTheOwnerAndAdminsTakeFromTheCrewShelf(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")
	h.join(t, c, "bob", "member")
	h.join(t, c, "carol", "admin")
	base := "/api/crews/" + store.UUIDString(c.id) + "/playlists/" + h.crewPlaylist(t, c.id, "alice")
	_, detail := h.call(t, "alice", http.MethodGet, base, "")
	rows, _ := detail["tracks"].([]any)
	var tracks []string
	for _, row := range rows {
		fields, _ := row.(map[string]any)
		id, _ := fields["id"].(string)
		tracks = append(tracks, id)
	}
	if len(tracks) != 2 {
		t.Fatalf("the fixture playlist holds %v, want two tracks", detail)
	}

	for _, step := range []struct {
		what, who, method, path, body string
		want                          int
	}{
		{"a member dropping a track", "bob", http.MethodDelete, base + "/tracks/" + tracks[0], "", http.StatusForbidden},
		{"an admin renaming it", "carol", http.MethodPut, base, `{"name":"Renamed"}`, http.StatusOK},
		{"an admin dropping a track", "carol", http.MethodDelete, base + "/tracks/" + tracks[0], "", http.StatusNoContent},
		{"the owner dropping a track", "alice", http.MethodDelete, base + "/tracks/" + tracks[1], "", http.StatusNoContent},
		{"the owner deleting it", "alice", http.MethodDelete, base, "", http.StatusNoContent},
	} {
		if status, body := h.call(t, step.who, step.method, step.path, step.body); status != step.want {
			t.Fatalf("%s: %d %v, want %d", step.what, status, body, step.want)
		}
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
	c := h.crew(t, "alice")
	first := c.voice()
	second := h.secondVoice(t, c.id)
	playlist := h.crewPlaylist(t, c.id, "alice")

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
	c := h.crew(t, "alice")
	first := c.voice()
	second := h.secondVoice(t, c.id)

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
	c := h.crew(t, "alice")
	voice, text := c.voice(), store.UUIDString(c.textID)
	playlist := h.crewPlaylist(t, c.id, "alice")
	foreign := h.crewPlaylist(t, h.crew(t, "bob").id, "bob")

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

// A voice channel's autoplay is set on the channel (#2434) and read here, by
// the hub's AutoplaySource — so the channel's page and the deck cannot
// disagree. And a refused save changes nothing (#2248): the switch, the order
// and the playlist were once three writes, and a playlist that was not the
// crew's was refused after the first two had committed, turning autoplay off.
func TestAChannelsAutoplayIsWhatItsDeckPlays(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")
	playlist := h.crewPlaylist(t, c.id, "alice")
	foreign := h.crewPlaylist(t, h.crew(t, "alice").id, "alice")

	if _, ok := h.svc.Autoplay(t.Context(), c.voice(), hub.SessionMood{}); ok {
		t.Fatal("autoplay played before anyone turned it on")
	}
	h.autoplay(t, c, fmt.Sprintf(`{"enabled":true,"order":"ordered","playlistId":%q}`, playlist))
	tracks, ok := h.svc.Autoplay(t.Context(), c.voice(), hub.SessionMood{})
	if !ok || len(tracks) != 2 || tracks[0].VideoID != "dQw4w9WgXcQ" {
		t.Errorf("the channel's autoplay = %v %+v, want the crew playlist in order", ok, tracks)
	}

	status, body := h.call(t, "alice", http.MethodPatch, "/api/channels/"+c.voice(),
		fmt.Sprintf(`{"autoplay":{"enabled":false,"order":"shuffled","playlistId":%q}}`, foreign))
	if status != http.StatusBadRequest || body["field"] != "autoplay.playlistId" {
		t.Fatalf("another crew's playlist: %d %v, want a 400 on autoplay.playlistId", status, body)
	}
	ch, err := h.store.Queries.GetChannel(t.Context(), c.voiceID)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !ch.AutoplayEnabled || ch.AutoplayOrder != "ordered" || store.UUIDString(ch.AutoplayPlaylistID) != playlist {
		t.Fatalf("the refusal changed the channel: enabled %v, order %q, playlist %s",
			ch.AutoplayEnabled, ch.AutoplayOrder, store.UUIDString(ch.AutoplayPlaylistID))
	}
}
