// The rider's own lane on the lobby socket (#4425): the phone remote of a
// ride alone. A ride is the rider's, not a channel's (ADR-0093), so a ride
// started on /ride holds no voice channel socket for the phone to find it
// through, as a channel's ride does (remote.go, ADR-0025). Every signed-in
// screen holds a lobby socket on every page, so the riding screen and the
// phone meet there.
//
// The lane is per rider and never crosses to another: a screen's frames go to
// its own rider's other screens and nowhere else, which is what keeps the
// lobby's promise (lobby.go) that nothing on it reaches past a channel's gate.
//
// First claim wins, as for a trainer (pairing.go): a second screen riding
// alone never takes the remote off the first, and the remote moves only when
// the riding screen ends its ride or closes.
package hub

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/textx"
)

// laneQueue bounds what waits to be written to one lobby socket. A remote
// press, its answers and the ride's whereabouts are a handful a second at
// most; a socket that falls this far behind loses frames, never the hub's time.
const laneQueue = 32

// laneReadLimit bounds one frame a screen sends on the lobby socket: the
// largest is a ViewState, well under this.
const laneReadLimit = 1024

// laneSide is one lobby socket's part in its rider's lane. Guarded by
// riderLanes.mu.
type laneSide struct {
	// The tab label from the socket's last RideClaim, or "" before one.
	tab    string
	device string
	riding bool
	// When this socket claimed the ride: the earliest still riding holds it.
	claimed uint64
	// What this socket was last told about the ride elsewhere.
	told    string
	toldAny bool
}

// riderLanes is every rider's lane: their lobby sockets, and who rides.
type riderLanes struct {
	mu     sync.Mutex
	now    func() time.Time
	seq    uint64
	riders map[string]map[*lobbyClient]struct{}
	// The last press per rider and kind, for remoteMinGap.
	last map[string]time.Time
}

func newRiderLanes(now func() time.Time) *riderLanes {
	return &riderLanes{
		now:    now,
		riders: make(map[string]map[*lobbyClient]struct{}),
		last:   make(map[string]time.Time),
	}
}

// laneSend is one frame for one socket, written once the lock is let go.
type laneSend struct {
	to    *lobbyClient
	frame protocol.LobbyLane
}

func (l *riderLanes) add(c *lobbyClient) {
	l.mu.Lock()
	defer l.mu.Unlock()
	socks := l.riders[c.rider]
	if socks == nil {
		socks = make(map[*lobbyClient]struct{})
		l.riders[c.rider] = socks
	}
	socks[c] = struct{}{}
}

// remove forgets a closed socket. A riding screen that closes lets the ride
// go, and its rider's other screens hear it.
func (l *riderLanes) remove(c *lobbyClient) []laneSend {
	l.mu.Lock()
	defer l.mu.Unlock()
	socks := l.riders[c.rider]
	delete(socks, c)
	if len(socks) == 0 {
		delete(l.riders, c.rider)
		for _, kind := range laneKinds {
			delete(l.last, kind+":"+c.rider)
		}
		return nil
	}
	return l.tellLocked(c.rider, nil)
}

// laneKinds is every rate-limit key the lane writes, so a rider's last
// socket closing forgets them all.
var laneKinds = func() []string {
	kinds := []string{"gear", "pause", "view"}
	for _, a := range protocol.RemoteActions {
		kinds = append(kinds, "remote:"+a)
	}
	return kinds
}()

// laneTab is a socket's tab label, or its own identity when it sent none.
func laneTab(c *lobbyClient) string {
	if c.lane.tab != "" {
		return c.lane.tab
	}
	return fmt.Sprintf("socket:%p", c)
}

// holderLocked is the socket whose claim holds the rider's ride: the
// earliest still riding. Nil when none rides.
func (l *riderLanes) holderLocked(rider string) *lobbyClient {
	var held *lobbyClient
	for c := range l.riders[rider] {
		if c.lane.riding && (held == nil || c.lane.claimed < held.lane.claimed) {
			held = c
		}
	}
	return held
}

// tellLocked says where the ride runs to every socket of the rider whose
// answer changed, and to `always` whatever it is: a screen that just said
// what it runs is owed the state, even an unchanged one.
func (l *riderLanes) tellLocked(rider string, always *lobbyClient) []laneSend {
	holder := l.holderLocked(rider)
	var out []laneSend
	for c := range l.riders[rider] {
		where := ""
		if holder != nil && laneTab(c) != laneTab(holder) {
			where = holder.lane.device
		}
		if c != always && c.lane.toldAny && c.lane.told == where {
			continue
		}
		c.lane.told, c.lane.toldAny = where, true
		out = append(out, laneSend{c, protocol.LobbyLane{Ride: &protocol.RideElsewhere{Device: where}}})
	}
	return out
}

// claim records what one screen rides. Untrusted, bounded as a SensorClaim.
func (l *riderLanes) claim(c *lobbyClient, claim protocol.RideClaim) []laneSend {
	l.mu.Lock()
	defer l.mu.Unlock()
	c.lane.tab = textx.Clip(claim.Tab, 64)
	c.lane.device = textx.Clip(claim.Device, 16)
	if claim.Riding && !c.lane.riding {
		l.seq++
		c.lane.claimed = l.seq
	}
	c.lane.riding = claim.Riding
	return l.tellLocked(c.rider, c)
}

// allowLocked is remoteMinGap per rider and kind.
func (l *riderLanes) allowLocked(rider, kind string) bool {
	now := l.now()
	key := kind + ":" + rider
	if now.Sub(l.last[key]) < remoteMinGap {
		return false
	}
	l.last[key] = now
	return true
}

func laneError(to *lobbyClient, code, message string) []laneSend {
	return []laneSend{{to, protocol.LobbyLane{Error: &protocol.Error{Code: code, Message: message}}}}
}

// remote relays a phone's press to the screen riding alone, never back to
// the phone's own tab. Refusals mirror a voice channel's (remote.go).
func (l *riderLanes) remote(c *lobbyClient, cmd protocol.RemoteCommand) []laneSend {
	if !protocol.IsRemoteAction(cmd.Action) {
		return laneError(c, "remote_validation_error", "That is not something the remote can do.")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if cmd.Action != "talk-up" && !l.allowLocked(c.rider, "remote:"+cmd.Action) {
		if cmd.Action == "talk-keepalive" {
			return nil
		}
		return laneError(c, "remote_rate_limited", "That was quick — give the remote a moment.")
	}
	holder := l.holderLocked(c.rider)
	if holder == nil || laneTab(holder) == laneTab(c) {
		return laneError(c, "remote_conflict", "No ride is running on another of your screens.")
	}
	var out []laneSend
	for other := range l.riders[c.rider] {
		if laneTab(other) == laneTab(holder) {
			out = append(out, laneSend{other, protocol.LobbyLane{Remote: &cmd}})
		}
	}
	return out
}

// answer forwards the riding screen's gear, pause or view to its rider's
// other screens. Only the riding screen may speak it, so a phone cannot put
// a gear on another phone; quiet when refused, as in a voice channel.
func (l *riderLanes) answer(c *lobbyClient, msg protocol.LobbyClientMessage) []laneSend {
	var kind string
	var frame protocol.LobbyLane
	switch {
	case msg.Gear != nil:
		g := *msg.Gear
		if g.Idle {
			// A riding screen with nothing to shift: the phone hears why in
			// the hub's words, never the screen's (remote.go's gearState).
			kind, frame = "gear", protocol.LobbyLane{Error: &protocol.Error{
				Code: "remote_conflict", Message: "Start riding to shift from here."}}
		} else {
			if g.Label == "" || utf8.RuneCountInString(g.Label) > protocol.MaxGearLabel {
				return nil
			}
			kind, frame = "gear", protocol.LobbyLane{Gear: &g}
		}
	case msg.Pause != nil:
		p := *msg.Pause
		kind, frame = "pause", protocol.LobbyLane{Pause: &p}
	case msg.View != nil:
		v := *msg.View
		if utf8.RuneCountInString(v.Page) > protocol.MaxViewPage ||
			utf8.RuneCountInString(v.Camera) > protocol.MaxViewPage || v.Pictures < 0 {
			return nil
		}
		kind, frame = "view", protocol.LobbyLane{View: &v}
	default:
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	holder := l.holderLocked(c.rider)
	if holder == nil || laneTab(holder) != laneTab(c) || !l.allowLocked(c.rider, kind) {
		return nil
	}
	var out []laneSend
	for other := range l.riders[c.rider] {
		if laneTab(other) != laneTab(holder) {
			out = append(out, laneSend{other, frame})
		}
	}
	return out
}

// heard handles one frame a screen sent on its lobby socket. Anything that
// does not parse, or names nothing, is dropped: an older client sends nothing.
func (l *riderLanes) heard(c *lobbyClient, data []byte) []laneSend {
	var msg protocol.LobbyClientMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil
	}
	switch {
	case msg.Ride != nil:
		return l.claim(c, *msg.Ride)
	case msg.Remote != nil:
		return l.remote(c, *msg.Remote)
	default:
		return l.answer(c, msg)
	}
}

// deliver queues each frame on its socket, after the lock.
func deliver(log *slog.Logger, sends []laneSend) {
	for _, s := range sends {
		frame, err := json.Marshal(s.frame)
		if err != nil {
			logger(log).Error("lane frame could not be marshalled", "err", err, "rider", s.to.rider)
			continue
		}
		select {
		case s.to.out <- frame:
		default:
			logger(log).Warn("lane frame dropped: the socket fell behind", "rider", s.to.rider)
		}
	}
}
