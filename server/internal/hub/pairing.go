// Sensor claims (#610): which of a rider's screens holds each sensor.
//
// A rider with a trainer paired on their phone used to be offered "Pair
// trainer" again on the desktop, and pairing there was worse than untidy. Live
// samples are keyed by rider id (setMetrics), and `seq` is minted per page
// session, so two streams interleaving trip the accumulator's new-stream
// detection: seqKey{stream, seq} stops colliding and BOTH devices' samples
// land in the one rider record — double-counted into the ride and into the
// live execution score. The fairness layer takes no doubles.
//
// So the hub arbitrates. Pairing itself stays in the browser that made the
// Bluetooth grant (ARCHITECTURE seam 1) — a grant cannot be handed to another
// device and this does not pretend otherwise. What the hub owns is the CLAIM:
// per rider, per kind, exactly one holder.
//
// First claim wins, which is where this parts company with the AV path's
// newest-wins arbitration (room/tabs.ts). A microphone changes hands between
// tabs harmlessly; a trainer is equipment somebody is riding, and letting a
// phone that just woke up steal it would drop the ERG targets of a ride in
// progress. Releasing is the owner's own act — Forget, or closing the tab.
package hub

import (
	"fmt"
	"slices"
	"sort"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// sensorKinds is the closed set a claim may name. Anything else is dropped:
// the map is per rider and never grows past this, so a client cannot invent
// kinds to fill it.
var sensorKinds = []string{"trainer", "heart-rate", "power-meter", "cadence"}

// holder is one claim: the tab that made it, and the word its owner's other
// screens render for it.
type holder struct {
	tab    string
	device string
}

// claimSensors records what this socket holds and returns whether anything
// changed — a claim that grants nothing new is silent, so an idle client
// repeating itself costs one comparison and no traffic.
//
// The claim is the socket's whole set: kinds the socket held and no longer
// names are released here, which is what makes "Forget" and a dropped message
// converge on the same state.
func (rm *room) claimSensors(c *client, claim protocol.SensorClaim) bool {
	// Untrusted input, bounded before it touches room state (errors.md): a
	// claim naming four kinds needs no more than this, and both strings are
	// stored per socket and copied per kind.
	if len(claim.Held) > len(sensorKinds) {
		claim.Held = claim.Held[:len(sensorKinds)]
	}
	claim.Tab = truncate(claim.Tab, 64)
	claim.Device = truncate(claim.Device, 16)

	rm.mu.Lock()
	defer rm.mu.Unlock()

	// The tab label is how a reload reclaims its own sensor rather than
	// queueing behind a socket the server has not yet reaped. Absent (an
	// older client, or one whose sessionStorage is blocked) it falls back to
	// the socket itself, which still arbitrates correctly — it just cannot
	// survive a reload.
	tab := claim.Tab
	if tab == "" {
		tab = c.tabFallback()
	}
	c.tab, c.device = tab, claim.Device

	if rm.claims == nil {
		rm.claims = make(map[string]map[string]holder)
	}
	held := rm.claims[c.rider.ID]
	if held == nil {
		held = make(map[string]holder)
		rm.claims[c.rider.ID] = held
	}

	changed := false
	for _, kind := range sensorKinds {
		want := slices.Contains(claim.Held, kind)
		owner, taken := held[kind]
		switch {
		case want && !taken:
			held[kind] = holder{tab: tab, device: claim.Device}
			changed = true
		case want && owner.tab == tab:
			// Same tab, possibly a new device word (a rotated phone, a
			// window dragged to another screen).
			if owner.device != claim.Device {
				held[kind] = holder{tab: tab, device: claim.Device}
				changed = true
			}
		case !want && taken && owner.tab == tab:
			// Released. Another tab's claim is never touched from here.
			delete(held, kind)
			changed = true
		}
	}
	// Never leave an empty map behind — a claim that granted nothing would
	// otherwise keep a per-rider entry alive for as long as the room does.
	if len(held) == 0 {
		delete(rm.claims, c.rider.ID)
	}
	return changed
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

// releaseSensors drops everything a leaving socket held, so the rider's other
// screens can pair. Called from leave, under the room lock already held there.
func (rm *room) releaseSensorsLocked(c *client) bool {
	held := rm.claims[c.rider.ID]
	if held == nil || c.tab == "" {
		return false
	}
	changed := false
	for kind, owner := range held {
		if owner.tab == c.tab {
			delete(held, kind)
			changed = true
		}
	}
	if len(held) == 0 {
		delete(rm.claims, c.rider.ID)
	}
	return changed
}

// pairingForLocked is what one socket is told: what it holds, and where the
// rest of its rider's sensors are.
func (rm *room) pairingForLocked(c *client) protocol.SensorPairing {
	out := protocol.SensorPairing{}
	for kind, owner := range rm.claims[c.rider.ID] {
		if owner.tab == c.tab {
			out.Held = append(out.Held, kind)
			continue
		}
		if out.Elsewhere == nil {
			out.Elsewhere = make(map[string]string)
		}
		// A device word is for display and may be missing on an older
		// client; say something true rather than nothing.
		device := owner.device
		if device == "" {
			device = "another device"
		}
		out.Elsewhere[kind] = device
	}
	// Stable order: the client renders from this, and a set iterated at random
	// would reorder identical state.
	sort.Strings(out.Held)
	return out
}

// ownsTrainerLocked answers the only question metrics need: may this socket
// speak for the rider?
//
// A rider with no trainer claim at all rides exactly as before — an older
// client, or one whose claim has not arrived yet, must not be silenced. The
// drop applies only when the claim exists and belongs to another screen.
func (rm *room) ownsTrainerLocked(c *client) bool {
	owner, taken := rm.claims[c.rider.ID]["trainer"]
	if !taken {
		return true
	}
	return owner.tab == c.tab
}

// queuePairingLocked lines up the answer for every socket of one rider —
// including the one that just claimed, which is how a client learns its claim
// was refused rather than granted.
//
// Queued rather than written here: the tick goroutine is the only writer per
// socket (coder/websocket forbids concurrent writes to one connection), and
// writing to a SIBLING socket from this read loop is exactly the race that
// would cause. Pair and unpair are not sub-second events; the next tick is
// soon enough.
func (rm *room) queuePairingLocked(riderID string) {
	if rm.pendingPairing == nil {
		rm.pendingPairing = make(map[*client]protocol.SensorPairing)
	}
	for c := range rm.clients {
		if c.rider.ID == riderID {
			rm.pendingPairing[c] = rm.pairingForLocked(c)
		}
	}
}

// announcePairing is claimSensors' follow-up: take the lock again and line up
// the answers. Separate from the claim itself so the claim can stay a pure
// decision under one lock acquisition.
func (rm *room) announcePairing(riderID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.queuePairingLocked(riderID)
}

// drainPairingLocked hands the tick loop what to send and forgets it. Called
// with the room lock held, like the rest of the tick's snapshotting.
func (rm *room) drainPairingLocked() map[*client]protocol.SensorPairing {
	if len(rm.pendingPairing) == 0 {
		return nil
	}
	out := rm.pendingPairing
	rm.pendingPairing = nil
	return out
}

// tabFallback identifies a socket that sent no tab label. Unique per
// connection, which is all the claim needs — it simply cannot outlive the
// socket the way a real tab id does across a reload.
func (c *client) tabFallback() string {
	return fmt.Sprintf("sock-%p", c)
}
