// Severing a rider's live presence from outside the socket: one voice
// channel's worth when a ban or a removal takes their place there (Kick), or
// everything a session opened once the session ends (DropUser, DropSession).
// A socket is authorised once, at connect, and keepalive holds it open for as
// long as the client answers pings — so a row deleted in the database closes
// nothing here unless it is asked to (#2807).
package hub

import (
	"bytes"
	"net/http"

	"github.com/coder/websocket"

	"github.com/natrontech/wattroom/server/internal/safego"
)

// VoiceEjector is LiveKit's half of dropping a rider (#2807): the call keeps a
// connected participant in it whatever its token's expiry says, so ending the
// right to be there has to remove them. Satisfied by *av.Service; absent
// without AV.
type VoiceEjector interface {
	Eject(channel, userID string)
}

// SetVoiceEjector wires LiveKit ejection in when AV is configured.
func (h *Hub) SetVoiceEjector(v VoiceEjector) { h.ejector = v }

// SetSessionKey wires in how the hub tells one session from another (#2807):
// the hash of the session a request rides on, nil when it carries none. The
// hub must not import auth, so it is handed in like SetLobbyAuth. Every socket
// keeps its session's key from connect, which is what lets a sign-out
// everywhere spare the screen that asked for it.
func (h *Hub) SetSessionKey(key func(*http.Request) []byte) { h.sessionKey = key }

func (h *Hub) sessionOf(r *http.Request) []byte {
	if h.sessionKey == nil {
		return nil
	}
	return h.sessionKey(r)
}

// Kick severs every socket a rider holds in channel — the live arm of a ban or
// removal (#223), which must eject, not drift.
func (h *Hub) Kick(channel, userID string) {
	h.mu.Lock()
	rm := h.rooms[channel]
	h.mu.Unlock()
	if rm == nil {
		return
	}
	conns := rm.connsWhere(func(c *client) bool { return c.rider.ID == userID })
	closeAll(conns)
	if len(conns) > 0 {
		h.log.Info("rider kicked", "channel", channel, "rider", userID, "sockets", len(conns))
	}
}

// DropUser severs every socket userID holds, in every voice channel and in the
// lobby, except those that rode in on the session keep hashes to, and ejects
// them from every call they are on (#2807). An empty keep spares nothing:
// recovery, and an account that no longer exists. The sessions are gone from
// the database before this is called, so the reconnect each severed client
// attempts is refused at the door.
//
// LiveKit knows connections, not sessions, so the call cannot spare the kept
// screen: it drops with the rest and its drop-rejoin mints a fresh token on
// its own session, which is still good (web/src/lib/channel/connection.svelte.ts).
func (h *Hub) DropUser(userID string, keep []byte) {
	closed, stood := h.sever(func(id string, session []byte) bool {
		return id == userID && (len(keep) == 0 || !bytes.Equal(session, keep))
	})
	h.mu.Lock()
	calls := h.voiceChannelsOfLocked(userID)
	ejector := h.ejector
	h.mu.Unlock()
	// A call LiveKit never reported still has its rider standing in the
	// channel's room, on a socket this just closed.
	for channel := range stood {
		calls[channel] = struct{}{}
	}
	if ejector != nil && len(calls) > 0 {
		// Off the caller's request: each ejection is bounded by av's own
		// budget, and a session ending must not wait on LiveKit to answer.
		safego.Go(h.log, "voice eject", func() {
			for channel := range calls {
				ejector.Eject(channel, userID)
			}
		})
	}
	if closed > 0 || len(calls) > 0 {
		h.log.Info("rider dropped", "rider", userID, "sockets", closed, "calls", len(calls))
	}
}

// DropSession severs every socket that rode in on one session (#2807): a
// sign-out on one tab ends the session every other tab of that browser shares
// through the cookie. The call is left to the tabs: LiveKit cannot say which
// of the rider's connections came from this session, and ejecting them all
// would take the rider's other devices out with it.
func (h *Hub) DropSession(session []byte) {
	if len(session) == 0 {
		return
	}
	closed, _ := h.sever(func(_ string, s []byte) bool { return bytes.Equal(s, session) })
	if closed > 0 {
		h.log.Info("session dropped", "sockets", closed)
	}
}

// sever closes every socket, lobby and voice channel alike, whose rider and
// session match picks, and names the channels it closed one in. Lock, copy,
// unlock, then close: CloseNow unblocks each read loop, whose defer runs the
// leave and the presence ping.
func (h *Hub) sever(match func(userID string, session []byte) bool) (closed int, channels map[string]struct{}) {
	h.mu.Lock()
	var conns []*websocket.Conn
	for c, id := range h.lobby {
		if match(id, c.session) {
			conns = append(conns, c.conn)
		}
	}
	rooms := make([]*room, 0, len(h.rooms))
	for _, rm := range h.rooms {
		rooms = append(rooms, rm)
	}
	h.mu.Unlock()
	channels = make(map[string]struct{})
	for _, rm := range rooms {
		in := rm.connsWhere(func(c *client) bool { return match(c.rider.ID, c.session) })
		if len(in) > 0 {
			conns = append(conns, in...)
			channels[rm.channel] = struct{}{}
		}
	}
	closeAll(conns)
	return len(conns), channels
}

// connsWhere is every socket in the room that match picks.
func (rm *room) connsWhere(match func(*client) bool) []*websocket.Conn {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	var conns []*websocket.Conn
	for c := range rm.clients {
		if match(c) {
			conns = append(conns, c.conn)
		}
	}
	return conns
}

func closeAll(conns []*websocket.Conn) {
	for _, conn := range conns {
		_ = conn.CloseNow()
	}
}
