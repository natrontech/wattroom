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

// How often a quiet socket is pinged, and how long its peer has to answer.
// Variables, not constants, so the half-open tests run in milliseconds rather
// than half a minute.
var (
	socketKeepalive   = 30 * time.Second
	socketPingTimeout = 5 * time.Second
)

// pingOrClose pings conn and waits socketPingTimeout for the pong. A peer that
// does not answer is gone: the conn is closed, which is what unblocks the
// reader parked on it so its handler runs the deferred leave and release, and
// false tells this socket's writer to return.
//
// Call it from the goroutine that writes this conn — a ping is a frame, and a
// conn takes one writer at a time.
func pingOrClose(ctx context.Context, conn *websocket.Conn) bool {
	ctx, cancel := context.WithTimeout(ctx, socketPingTimeout)
	err := conn.Ping(ctx)
	cancel()
	if err != nil {
		_ = conn.CloseNow()
		return false
	}
	return true
}
