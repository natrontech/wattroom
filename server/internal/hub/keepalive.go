// The one keepalive both of the hub's sockets use. A peer that goes away
// without a close frame — a sleeping laptop, a NAT drop, a phone losing
// signal — leaves a half-open connection: the server's read blocks on it
// forever, so the rider keeps reading as online to every friend, keeps a seat
// in the room's roster, and keeps a slot of their per-rider socket budget,
// until TCP notices, if it ever does (#1506, #1740). A ping is the only thing
// that finds out, so both writers send one.
package hub

import (
	"context"
	"time"

	"github.com/coder/websocket"
)

// How often a quiet socket is pinged, and how long its peer then has to
// answer before it is treated as gone.
const (
	socketKeepalive   = 30 * time.Second
	socketPingTimeout = 5 * time.Second
)

// keepalive is a socket's ping schedule. Carried on the Hub like h.now rather
// than read from package-level variables, so the half-open tests can run in
// milliseconds without two of them sharing mutable state.
type keepalive struct {
	every time.Duration
	pong  time.Duration
}

// beat is the writer's own ticker. It is not reset by a frame going out: a
// write to a half-open socket lands in the kernel's buffer and reports
// success, so having written to a peer says nothing about the peer being
// there. Only the pong does, and a room socket writing a tick a second is
// exactly the case that used to hide behind that.
func (k keepalive) beat() *time.Ticker { return time.NewTicker(k.every) }

// pingOrClose pings conn and gives the peer k.pong to answer. A peer that
// does not is gone: the conn is closed, which is what unblocks the reader
// parked on it so its handler runs the deferred leave and release, and false
// tells this socket's writer to return.
//
// Call it from the goroutine that writes this conn — a ping is a frame, and a
// conn takes one writer at a time.
func (k keepalive) pingOrClose(ctx context.Context, conn *websocket.Conn) bool {
	ctx, cancel := context.WithTimeout(ctx, k.pong)
	err := conn.Ping(ctx)
	cancel()
	if err != nil {
		_ = conn.CloseNow()
		return false
	}
	return true
}
