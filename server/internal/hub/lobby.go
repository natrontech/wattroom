// The lobby socket (#251): every signed-in client holds one, and the hub
// pushes an empty ping whenever presence changes anywhere — a roster, voice,
// camera, phase, or riding-set change, or a user coming online. The socket
// carries no data at all: clients re-fetch the HTTP endpoints they already
// use, which stay membership-filtered, so nothing here can pierce the room
// boundary. Holding the socket IS being online (WhereIs reads it) — no
// heartbeats, no last-seen timestamps, closing it is going offline.
package hub

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/websocket"
)

type lobbyClient struct {
	conn *websocket.Conn
	// Size 1: a burst of changes coalesces into one ping per client.
	ping chan struct{}
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
	go func() {
		// Writer: exits when the reader below returns (done) or a write fails.
		for {
			select {
			case <-done:
				return
			case <-c.ping:
				ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
				err := conn.Write(ctx, websocket.MessageText, []byte("{}"))
				cancel()
				if err != nil {
					return
				}
			}
		}
	}()
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
		select {
		case c.ping <- struct{}{}:
		default: // a ping is already queued — one is enough
		}
	}
}
