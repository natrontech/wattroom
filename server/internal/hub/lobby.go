// The lobby socket (#251): every signed-in client holds one, and the hub
// pushes an empty ping whenever presence changes anywhere — a roster, voice,
// camera, phase, or riding-set change, or a user coming online. The socket
// carries no data at all: clients re-fetch the HTTP endpoints they already
// use, which stay membership-filtered, so nothing here can pierce the room
// boundary. Holding the socket IS being online (WhereIs reads it) — no
// last-seen timestamps, closing it is going offline; the keepalive in
// keepalive.go is how the server notices a close that never arrived.
package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/coder/websocket"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
)

type lobbyClient struct {
	conn *websocket.Conn
	// Size 1: a burst of changes coalesces into one ping per client.
	ping chan struct{}
	// What the queued ping says: the one channel it is about, or "" for
	// everything. Two different reasons coalesce into "", which re-fetches
	// more than needed and never less.
	mu      sync.Mutex
	queued  bool
	channel string
}

// queue asks for a ping about channel ("" is everything).
func (c *lobbyClient) queue(channel string) {
	c.mu.Lock()
	if c.queued && c.channel != channel {
		channel = ""
	}
	c.queued, c.channel = true, channel
	c.mu.Unlock()
	select {
	case c.ping <- struct{}{}:
	default: // a ping is already queued — one is enough
	}
}

// take is the ping the writer sends, and clears what was queued.
func (c *lobbyClient) take() []byte {
	c.mu.Lock()
	channel := c.channel
	c.queued, c.channel = false, ""
	c.mu.Unlock()
	msg, _ := json.Marshal(protocol.LobbyPing{Channel: channel})
	return msg
}

// SetLobbyAuth wires session resolution in after construction — the hub must
// not import the auth package (same late-binding shape as SetChatKeeper).
// Nil keeps the endpoint unmounted-in-effect: it refuses everyone.
func (h *Hub) SetLobbyAuth(auth func(*http.Request) (userID string, ok bool)) {
	h.lobbyAuth = auth
}

// HandleLobbyWS holds one client's lobby socket open until it drops.
func (h *Hub) HandleLobbyWS(w http.ResponseWriter, r *http.Request) {
	if h.lobbyAuth == nil {
		http.Error(w, "presence unavailable", http.StatusNotFound)
		return
	}
	userID, ok := h.lobbyAuth(r)
	if !ok {
		// Before the upgrade, like HandleWS: a plain status beats a WS close code.
		http.Error(w, "not signed in", http.StatusUnauthorized)
		return
	}
	if !h.admitSocket(userID) {
		http.Error(w, "too many open connections for this rider", http.StatusServiceUnavailable)
		return
	}
	defer h.releaseSocket(userID)
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	c := &lobbyClient{conn: conn, ping: make(chan struct{}, 1)}
	h.mu.Lock()
	h.lobby[c] = userID
	h.mu.Unlock()
	// Coming online is itself a presence change — friends panels go green.
	h.PresenceChanged()
	defer func() {
		h.mu.Lock()
		delete(h.lobby, c)
		h.mu.Unlock()
		_ = conn.CloseNow()
		h.PresenceChanged()
	}()

	done := make(chan struct{})
	safego.Go(h.log, "lobby writer", func() {
		// Writer: exits when the reader below returns (done), a write fails,
		// or a ping goes unanswered (keepalive.go — pingOrClose closes the
		// conn, which unblocks the reader below).
		beat := h.keepalive.beat()
		defer beat.Stop()
		for {
			select {
			case <-done:
				return
			case <-beat.C:
				// The lobby has no roster to put a round trip on; only the
				// liveness half matters here (#2131).
				if _, alive := h.keepalive.pingOrClose(r.Context(), conn); !alive {
					return
				}
			case <-c.ping:
				ctx, cancel := context.WithTimeout(r.Context(), writeTimeout)
				err := conn.Write(ctx, websocket.MessageText, c.take())
				cancel()
				if err != nil {
					_ = conn.CloseNow()
					return
				}
			}
		}
	})
	// Reader: clients send nothing — this blocks until the socket closes.
	for {
		if _, _, err := conn.Read(r.Context()); err != nil {
			break
		}
	}
	close(done)
}

// PresenceChanged pings every lobby client: something about who-is-where
// changed, re-fetch. Callers already holding h.mu use pingLobbyLocked.
// ponytail: every client re-fetches the full lists per ping — per-user diffs
// when the fleet outgrows one crew.
func (h *Hub) PresenceChanged() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pingLobbyLocked()
}

func (h *Hub) pingLobbyLocked() {
	for c := range h.lobby {
		c.queue("")
	}
}

// ChannelChanged pings every lobby client about one text channel's log
// (#2435): a client looking at it re-fetches that channel and nothing else.
// ponytail: every client hears it, crew or not — the id is opaque and the
// log is behind its gate; route by crew when the lobby learns crews (#2324).
func (h *Hub) ChannelChanged(channelID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.lobby {
		c.queue(channelID)
	}
}
