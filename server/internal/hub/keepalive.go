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

// How often a socket is pinged, and how long its peer then has to answer
// before it is treated as gone.
//
// Five seconds rather than the thirty this started at (#2131). The ping is
// now a measurement as well as a liveness check — the round trip is the
// rider's ping on the roster — and a number that refreshes every thirty
// seconds is stale on the surface a rider opens to read it. Pinging more
// often only makes the half-open detection above faster, never more
// trigger-happy: the peer still gets socketPingTimeout to answer each one.
// The cost is a ping frame per socket per interval, against a room socket
// that already writes a whole tick every second.
const (
	socketKeepalive   = 5 * time.Second
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
// The round trip comes back with it (#2131). coder/websocket's Ping blocks
// until the matching pong arrives, so timing the call IS the measurement —
// there is no second protocol to add, and the number is the server's own
// rather than something the client reported about itself, which is what makes
// it safe to show one rider about another.
//
// Call it from the goroutine that writes this conn — a ping is a frame, and a
// conn takes one writer at a time.
func (k keepalive) pingOrClose(ctx context.Context, conn *websocket.Conn) (time.Duration, bool) {
	ctx, cancel := context.WithTimeout(ctx, k.pong)
	start := time.Now()
	err := conn.Ping(ctx)
	rtt := time.Since(start)
	cancel()
	if err != nil {
		_ = conn.CloseNow()
		return 0, false
	}
	return rtt, true
}
