package hub

// Who is in a voice channel: a socket joining and leaving, the grace a
// departure gets, and a rider stepping away. Split from room.go (#3357).

import (
	"slices"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func (rm *channelState) join(c *client) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	// Whether this is the rider arriving or only another of their screens
	// (#219: a person on a desktop and a phone is one presence).
	first := !rm.presentLocked(c.rider.ID)
	rm.clients[c] = struct{}{}
	metricRiders.Inc()
	if !first {
		return
	}
	// A socket that flapped is not an arrival. It was never announced as a
	// leave either, so the room hears nothing about the round trip.
	if _, flapped := rm.departed[c.rider.ID]; flapped {
		delete(rm.departed, c.rider.ID)
		delete(rm.departedNames, c.rider.ID)
		return
	}
	now := rm.now()
	rm.events.add(presenceLine("joined", c.rider.Name, now), now)
}

// presentLocked is whether any socket in this room belongs to that rider.
func (rm *channelState) presentLocked(riderID string) bool {
	for c := range rm.clients {
		if c.rider.ID == riderID {
			return true
		}
	}
	return false
}

// sayDepartedLocked announces everyone whose grace window has run out. Called
// from the tick, which is the only clock the room has.
func (rm *channelState) sayDepartedLocked(now time.Time) {
	for riderID, at := range rm.departed {
		if now.Sub(at) < presenceGrace {
			continue
		}
		delete(rm.departed, riderID)
		if name := rm.departedNames[riderID]; name != "" {
			rm.events.add(presenceLine("left", name, now), now)
			delete(rm.departedNames, riderID)
		}
		if riderID == rm.session.coach && rm.session.open() {
			rm.passSessionLocked(now)
		}
		// Out of the game too (#1577), and only now (#2832): a paceline must
		// not hand the front to a closed tab, and a podium is not topped from
		// outside the room — but a reload is a leave and a join inside the
		// grace, and withdrawing on the leave cost the rider the game.
		if w, ok := rm.game.(withdrawing); ok {
			w.withdraw(riderID)
		}
	}
}

func (rm *channelState) leave(c *client) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	delete(rm.clients, c)
	delete(rm.pendingPairing, c)
	delete(rm.pendingPokes, c)
	// Closing a tab frees its sensors, so the rider's other screens can pair
	// (#610). Queued after the delete above, so the leaver is not told.
	if rm.releaseSensorsLocked(c) {
		rm.queuePairingLocked(c.rider.ID)
	}
	// A phone spectator closing must not blank the desktop's tile: metrics
	// go only when the rider's LAST socket does (#219).
	last := true
	for other := range rm.clients {
		if other.rider.ID == c.rider.ID {
			last = false
			break
		}
	}
	if last {
		delete(rm.metrics, c.rider.ID)
		// Away is presence, and the rider is no longer present (#706).
		// Left behind, it would greet them as away on the next join.
		delete(rm.away, c.rider.ID)
		// Their clip left with them: every listener stops it on the leave,
		// so a stale entry would only tell the next joiner to start a sound
		// nobody else can hear.
		delete(rm.sounding, c.rider.ID)
		// Not announced yet — nor out of the game: the tick does both once
		// the grace window is out (sayDepartedLocked).
		rm.departed[c.rider.ID] = rm.now()
		rm.departedNames[c.rider.ID] = c.rider.Name
	}
	metricRiders.Dec()
}

// setAway records a rider stepping out or coming back (#706). Per rider: it
// reaches every screen they hold, which is what makes pressing the button on
// the desktop clear the mark the phone is also drawing.
//
// reason is one of protocol.AwayReasons or "" for the plain away; anything
// else is dropped to "" rather than refused, because the state is the point
// and an unknown word is a client this server is older than.
func (rm *channelState) setAway(riderID string, away bool, reason string) {
	if !away || !slices.Contains(protocol.AwayReasons, reason) {
		reason = ""
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	wasReason, was := rm.away[riderID]
	if away {
		rm.away[riderID] = reason
	} else {
		delete(rm.away, riderID)
	}
	// Only the change is worth a line: a tab restating what it already said
	// on every reconnect would print one every time (#984). Changing from one
	// reason to another IS a change — "Ana is refuelling" after "Ana went
	// away" is the room learning something.
	if was == away && wasReason == reason {
		return
	}
	name := rm.nameOfLocked(riderID)
	if name == "" {
		return
	}
	now := rm.now()
	rm.events.restate(presenceLine(awayVerb(away, reason), name, now), now)
}

// awayVerb is the timeline's word for a state. One verb per state rather than
// a verb plus a payload, so the client's renderer stays the lookup it already
// is and an unknown verb from a newer server draws nothing rather than
// something wrong.
func awayVerb(away bool, reason string) string {
	if !away {
		return "back"
	}
	if reason == "" {
		return "away"
	}
	return "away_" + reason
}
