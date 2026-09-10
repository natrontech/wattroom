package hub

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Both of the hub's sockets are exercised here because presence is read from
// both: WhereIs takes "online" from the lobby socket and "in room X" from the
// room socket, so a keepalive on one of them leaves half the lie standing.
var keepaliveCases = []struct {
	name    string
	path    string
	present func(h *Hub) bool
}{
	{
		name:    "lobby socket: online",
		path:    "/ws/presence",
		present: func(h *Hub) bool { _, ok := h.WhereIs([]string{"jan"})["jan"]; return ok },
	},
	{
		name:    "room socket: in a room",
		path:    "/ws/rooms/velvet",
		present: func(h *Hub) bool { return h.WhereIs([]string{"jan"})["jan"] == "velvet" },
	},
}

// keepaliveHub is a hub on a ping schedule measured in milliseconds, with both
// socket endpoints mounted, and the address to dial them at.
func keepaliveHub(t *testing.T) (*Hub, string) {
	t.Helper()
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	// This hub's own schedule, so half a minute of waiting becomes a
	// twentieth of a second and no other test is affected.
	h.keepalive = keepalive{every: 20 * time.Millisecond, pong: 100 * time.Millisecond}
	h.SetLobbyAuth(func(r *http.Request) (string, bool) {
		name, _, _ := strings.Cut(r.Header.Get("X-Rider"), ":")
		return name, name != ""
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/presence", h.HandleLobbyWS)
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return h, "ws" + strings.TrimPrefix(srv.URL, "http")
}

// A socket whose peer went quiet without a close frame — a sleeping laptop, a
// NAT drop, a phone losing signal — must stop reading as present once a ping
// goes unanswered (#1506, #1740), rather than holding the rider online for
// every friend, in a room's roster, and one slot down on their socket budget
// until TCP notices, if it ever does.
//
// The peer completes the handshake and then never reads, which is exactly a
// half-open socket's behaviour: a coder/websocket client answers pings only
// from its read loop, so the server's ping reaches the kernel and nothing ever
// answers it.
func TestAHalfOpenSocketStopsReadingAsPresent(t *testing.T) {
	for _, tc := range keepaliveCases {
		t.Run(tc.name, func(t *testing.T) {
			h, base := keepaliveHub(t)
			quiet := dial(t, base+tc.path, "jan:member")
			eventually(t, "jan reads present", func() bool { return tc.present(h) })
			eventually(t, "jan stops reading present once a ping went unanswered", func() bool {
				return !tc.present(h)
			})
			// And the socket budget the leak used to hold is released with it —
			// the handler's own deferred release, a moment after the map.
			eventually(t, "jan's socket budget is released", func() bool {
				h.mu.Lock()
				defer h.mu.Unlock()
				return h.sockets["jan"] == 0
			})
			_ = quiet.CloseNow()
		})
	}
}

// The other half of the keepalive's job, and the more expensive one to get
// wrong: a peer that IS answering must be left alone. A ping that hangs up on
// a live socket would throw every rider out every keepalive period, mid-ride,
// which is worse than the zombie presence it was added to fix.
func TestASocketThatAnswersPingsIsNotDropped(t *testing.T) {
	for _, tc := range keepaliveCases {
		t.Run(tc.name, func(t *testing.T) {
			h, base := keepaliveHub(t)
			conn := dial(t, base+tc.path, "jan:member")
			// Reading is all a peer has to do: pongs are answered from the read
			// loop, which is also why a browser needs no code of its own here.
			go func() {
				for {
					if _, _, err := conn.Read(t.Context()); err != nil {
						return
					}
				}
			}()
			eventually(t, "jan reads present", func() bool { return tc.present(h) })
			// Ten ping periods, asserted throughout rather than at the end, so
			// a drop anywhere inside the window fails rather than being slept
			// through.
			deadline := time.Now().Add(10 * h.keepalive.every)
			for time.Now().Before(deadline) {
				if !tc.present(h) {
					t.Fatal("jan was dropped while answering every ping")
				}
				time.Sleep(time.Millisecond)
			}
			_ = conn.CloseNow()
		})
	}
}
