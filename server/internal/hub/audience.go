package hub

import (
	"context"
	"time"

	"github.com/natrontech/wattroom/server/internal/safego"
)

// Audiences names who a change born in the hub concerns (#2324): a socket
// opening or closing, a voice roster, a session's phase or riding set. The
// server answers from the store — the hub never touches the database and
// holds no membership — and the hub asks outside h.mu, off the tick's path.
type Audiences interface {
	// Whoever may enter the channel, plus the riders the change moved and
	// their friends, whose lists say "in voice" and "riding".
	Channel(ctx context.Context, channel string, riders []string) ([]string, error)
	// A rider coming online or going offline: the rider, their friends and
	// their crew-mates.
	Rider(ctx context.Context, rider string) ([]string, error)
}

// audienceTimeout bounds one lookup. Past it the change is told to everyone,
// which is what every change did before #2324.
const audienceTimeout = 5 * time.Second

// SetAudiences wires the resolver in after construction, like SetLobbyAuth,
// and before the first socket opens. Nil keeps every hub-born change
// fleet-wide.
func (h *Hub) SetAudiences(a Audiences) { h.audiences = a }

// PresenceChangedFor pings the lobby sockets of the riders a change concerns
// (#2324) — every device of each, and nobody else. The ping stays empty: who
// it went to is the whole of the routing, and no stranger can read activity
// off it.
func (h *Hub) PresenceChangedFor(audience []string) {
	// A set built outside the lock: a crew can be large, and the loop below
	// runs under the hub's one mutex.
	to := make(map[string]bool, len(audience))
	for _, userID := range audience {
		to[userID] = true
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c, userID := range h.lobby {
		if to[userID] {
			c.queue("")
		}
	}
}

// tellChannel pings who a change in one channel concerns, resolved off the
// caller's path: a socket's upgrade, a webhook, or the tick, none of which
// may wait on the database.
func (h *Hub) tellChannel(channel string, riders ...string) {
	h.tell(func(ctx context.Context) ([]string, error) {
		return h.audiences.Channel(ctx, channel, riders)
	})
}

// tellRider pings who a rider's coming online or going offline concerns.
func (h *Hub) tellRider(rider string) {
	h.tell(func(ctx context.Context) ([]string, error) {
		return h.audiences.Rider(ctx, rider)
	})
}

// tell resolves an audience on its own goroutine, which ends with the lookup
// or its timeout. No resolver, or one that failed, tells everyone: a wider
// re-fetch is the safe direction, a missed one is not.
func (h *Hub) tell(resolve func(context.Context) ([]string, error)) {
	if h.audiences == nil {
		h.PresenceChanged()
		return
	}
	safego.Go(h.log, "presence audience", func() {
		ctx, cancel := context.WithTimeout(context.Background(), audienceTimeout)
		defer cancel()
		audience, err := resolve(ctx)
		if err != nil {
			logger(h.log).Warn("presence audience lookup failed; pinging everyone", "err", err)
			h.PresenceChanged()
			return
		}
		h.PresenceChangedFor(audience)
	})
}
