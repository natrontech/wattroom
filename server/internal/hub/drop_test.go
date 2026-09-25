package hub

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// droppable is a hub whose sockets say who they are and which session they
// rode in on: X-Rider as everywhere in these tests, X-Session for the key the
// auth package would hash out of the cookie. withKey=false is a hub nobody
// wired a session key into, where every socket's session is nil.
func droppable(t *testing.T, withKey bool) (*Hub, string) {
	t.Helper()
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetLobbyAuth(func(r *http.Request) (string, bool) {
		name, _, _ := strings.Cut(r.Header.Get("X-Rider"), ":")
		return name, name != ""
	})
	if withKey {
		h.SetSessionKey(func(r *http.Request) []byte {
			if v := r.Header.Get("X-Session"); v != "" {
				return []byte(v)
			}
			return nil
		})
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	mux.HandleFunc("GET /ws/presence", h.HandleLobbyWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return h, "ws" + strings.TrimPrefix(srv.URL, "http")
}

// dialAs opens a socket as rider on session ("" = none).
func dialAs(t *testing.T, url, rider, session string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	header := http.Header{"X-Rider": []string{rider}}
	if session != "" {
		header.Set("X-Session", session)
	}
	conn, res, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: header})
	if res != nil && res.Body != nil {
		defer func() { _ = res.Body.Close() }()
	}
	if err != nil {
		t.Fatalf("dial as %q on %q: %v", rider, session, err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn
}

// registered counts the sockets the hub holds for a rider, lobby and every
// channel together — what a dial has to reach before a drop can find it.
func registered(h *Hub, rider string) int {
	h.mu.Lock()
	n := 0
	for _, id := range h.lobby {
		if id == rider {
			n++
		}
	}
	rooms := make([]*room, 0, len(h.rooms))
	for _, rm := range h.rooms {
		rooms = append(rooms, rm)
	}
	h.mu.Unlock()
	for _, rm := range rooms {
		n += len(rm.connsWhere(func(c *client) bool { return c.rider.ID == rider }))
	}
	return n
}

// severed reports whether the server closed conn: reading it runs into the
// close, past whatever frames were already on their way, well before the
// deadline an open socket would read on until.
func severed(t *testing.T, conn *websocket.Conn) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	for {
		if _, _, err := conn.Read(ctx); err != nil {
			return ctx.Err() == nil
		}
	}
}

// answersPing reports whether the server end of conn still reads: a ping
// sent now comes back only from a socket the drop left open. Ping sees its
// pong only while something reads, so a reader runs beside it and discards
// whatever the server pushes meanwhile. Spends the socket — the reader's
// context ends with the check — so it is the last thing done with one.
func answersPing(t *testing.T, conn *websocket.Conn) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	go func() {
		for {
			if _, _, err := conn.Read(ctx); err != nil {
				return
			}
		}
	}()
	return conn.Ping(ctx) == nil
}

// Sign out everywhere (#2807): every socket of the rider's other sessions
// closes, in every channel and in the lobby, and the screen that asked keeps
// both of its own. Nobody else's socket is touched.
func TestDropUserSparesTheSessionThatAsked(t *testing.T) {
	h, base := droppable(t, true)
	kept := map[string]*websocket.Conn{
		"jan's own room socket":  dialAs(t, base+"/ws/channels/velvet", "jan:member", "A"),
		"jan's own lobby socket": dialAs(t, base+"/ws/presence", "jan:member", "A"),
		"sven's room socket":     dialAs(t, base+"/ws/channels/velvet", "sven:member", "C"),
		"sven's lobby socket":    dialAs(t, base+"/ws/presence", "sven:member", "C"),
	}
	dropped := map[string]*websocket.Conn{
		"the other session in the same room": dialAs(t, base+"/ws/channels/velvet", "jan:member", "B"),
		"the other session in another room":  dialAs(t, base+"/ws/channels/tempo", "jan:member", "B"),
		"the other session's lobby socket":   dialAs(t, base+"/ws/presence", "jan:member", "B"),
	}
	eventually(t, "every socket registered", func() bool {
		return registered(h, "jan") == 5 && registered(h, "sven") == 2
	})

	h.DropUser("jan", []byte("A"))

	for what, conn := range dropped {
		if !severed(t, conn) {
			t.Errorf("%s is still open after its session ended", what)
		}
	}
	for what, conn := range kept {
		if !answersPing(t, conn) {
			t.Errorf("%s was closed by someone else's sign-out", what)
		}
	}
}

// Recovery and account deletion spare nothing, whatever the sockets carry —
// including a hub with no session key wired, where every socket's session is
// nil and a nil keep must not read as "the same session".
func TestDropUserWithoutAKeptSessionSparesNothing(t *testing.T) {
	for _, tc := range []struct {
		name    string
		withKey bool
		keep    []byte
	}{
		{"nil keep", true, nil},
		{"empty keep", true, []byte{}},
		{"no session key wired", false, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, base := droppable(t, tc.withKey)
			conns := []*websocket.Conn{
				dialAs(t, base+"/ws/channels/velvet", "jan:member", "A"),
				dialAs(t, base+"/ws/presence", "jan:member", "A"),
				dialAs(t, base+"/ws/presence", "jan:member", ""),
			}
			eventually(t, "jan's sockets registered", func() bool { return registered(h, "jan") == 3 })

			h.DropUser("jan", tc.keep)

			for i, conn := range conns {
				if !severed(t, conn) {
					t.Errorf("socket %d survived a drop that spares nothing", i)
				}
			}
		})
	}
}

// ejections is a VoiceEjector that hands every ejection to the test.
type ejections chan [2]string

func (e ejections) Eject(channel, userID string) { e <- [2]string{channel, userID} }

// The call half (#2807): a connected LiveKit participant stays in the call
// whatever its token says, so the rider is ejected from every channel
// LiveKit reported them in — and from one where only their socket stood,
// since a lost webhook leaves the voice map short.
func TestDropUserEjectsFromEveryCall(t *testing.T) {
	h, base := droppable(t, true)
	ejected := make(ejections, 8)
	h.SetVoiceEjector(ejected)
	h.VoiceJoined("velvet", "jan#1", "jan")
	h.VoiceJoined("tempo", "jan#2", "jan")
	h.VoiceJoined("velvet", "sven#1", "sven")
	dialAs(t, base+"/ws/channels/spin", "jan:member", "A")
	eventually(t, "jan's socket registered", func() bool { return registered(h, "jan") == 1 })

	h.DropUser("jan", nil)

	var got []string
	for len(got) < 3 {
		select {
		case e := <-ejected:
			if e[1] != "jan" {
				t.Fatalf("ejected %s from %s", e[1], e[0])
			}
			got = append(got, e[0])
		case <-time.After(2 * time.Second):
			t.Fatalf("ejected from %v, want velvet, tempo and spin", got)
		}
	}
	slices.Sort(got)
	if want := []string{"spin", "tempo", "velvet"}; !slices.Equal(got, want) {
		t.Fatalf("ejected from %v, want %v", got, want)
	}
}

// A sign-out on one tab (#2807) closes that browser's other tabs, which share
// the cookie and so the session — and nothing on any other session, nor a
// socket that carries none.
func TestDropSessionClosesThatSessionOnly(t *testing.T) {
	h, base := droppable(t, true)
	dropped := []*websocket.Conn{
		dialAs(t, base+"/ws/channels/velvet", "jan:member", "A"),
		dialAs(t, base+"/ws/presence", "jan:member", "A"),
	}
	kept := []*websocket.Conn{
		dialAs(t, base+"/ws/channels/velvet", "jan:member", "B"),
		dialAs(t, base+"/ws/presence", "jan:member", ""),
	}
	eventually(t, "jan's sockets registered", func() bool { return registered(h, "jan") == 4 })

	h.DropSession(nil)
	h.DropSession([]byte{})
	h.DropSession([]byte("A"))

	for i, conn := range dropped {
		if !severed(t, conn) {
			t.Errorf("session A's socket %d is still open after it signed out", i)
		}
	}
	for i, conn := range kept {
		if !answersPing(t, conn) {
			t.Errorf("socket %d on another session closed with A's sign-out", i)
		}
	}
}

// A ban or a removal (#223) severs the rider in that one channel: their
// sockets elsewhere, and the lobby, stay.
func TestKickSeversOneChannel(t *testing.T) {
	h, base := droppable(t, true)
	kicked := dialAs(t, base+"/ws/channels/velvet", "jan:member", "A")
	kept := []*websocket.Conn{
		dialAs(t, base+"/ws/channels/tempo", "jan:member", "A"),
		dialAs(t, base+"/ws/presence", "jan:member", "A"),
		dialAs(t, base+"/ws/channels/velvet", "sven:member", "C"),
	}
	eventually(t, "every socket registered", func() bool {
		return registered(h, "jan") == 3 && registered(h, "sven") == 1
	})

	h.Kick("velvet", "jan")

	if !severed(t, kicked) {
		t.Errorf("jan's socket in the channel he was removed from is still open")
	}
	for i, conn := range kept {
		if !answersPing(t, conn) {
			t.Errorf("socket %d outside the kick closed with it", i)
		}
	}
}
