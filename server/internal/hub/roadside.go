package hub

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// The roadside on the bunch's road (ADR-0064, #3029): where each spectator
// stands. It paints, sounds and informs; nothing here reaches a rider's
// trainer, place or score, and a spectator never picks a rider. Nothing is
// kept past the run — the stands go with the bunch they stood beside.

const standMoveEvery = protocol.RoadsideStandMoveSeconds * time.Second

// stand is one spectator's stand: where on the road, laps unrolled, and
// when they last put it there.
type stand struct {
	u       float64
	movedAt time.Time
}

// roadside takes one spectator's verb, answering the socket when it is
// refused: a deliberate tap the spectator watches for a result (errors.md).
func (h *Hub) roadside(c *client, rm *channelState, rider protocol.Rider, verb protocol.Roadside) {
	now := h.now()
	if !rm.allow("roadside", rider.ID, now, controlMinGap) {
		h.writeError(c, "roadside_rate_limited", "One thing at a time at the roadside — try that again in a moment.")
		return
	}
	if code, message := rm.roadsideVerb(rider.ID, verb, now); code != "" {
		h.writeError(c, "roadside_"+code, message)
	}
}

// roadsideVerb puts one spectator's verb on the session's road, or says why
// not in errors.md's codes.
func (rm *channelState) roadsideVerb(riderID string, verb protocol.Roadside, now time.Time) (code, message string) {
	if verb.Kind != protocol.RoadsideKindStand {
		return "validation_error", "The roadside can take a stand, and nothing else yet."
	}
	if math.IsNaN(verb.AtM) || math.IsInf(verb.AtM, 0) || verb.Lap < 0 {
		return "validation_error", "That is not a place on the road."
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if !rm.session.onRoad() {
		return "invalid_request", "There is no road to stand beside — a stand needs a session riding one."
	}
	if rm.session.rides(riderID) {
		return "forbidden", "You are riding this session. The roadside is everyone who is not."
	}
	return rm.session.bunch.standAt(riderID, verb, now)
}

// standAt puts a spectator's stand where they asked: 300 m – 5 km ahead of
// the bunch, moved at most once a minute, and never while the riders are
// closing on the one they have (docs/SPEC.md "The roadside").
func (b *bunch) standAt(riderID string, verb protocol.Roadside, now time.Time) (code, message string) {
	if verb.AtM < 0 || verb.AtM > b.road.LengthM || verb.Lap > 0 && !b.loop {
		return "validation_error", "That is not a place on this road."
	}
	u, bunchU := float64(verb.Lap)*b.road.LengthM+verb.AtM, b.fromM+b.pace.Distance
	if ahead := u - bunchU; ahead < protocol.RoadsideStandMinAheadM || ahead > protocol.RoadsideStandMaxAheadM {
		return "validation_error", fmt.Sprintf("A stand goes %d m – %d km ahead of the bunch.",
			protocol.RoadsideStandMinAheadM, protocol.RoadsideStandMaxAheadM/1000)
	}
	if held := b.stands[riderID]; held != nil {
		// Frozen near riders (ADR-0064): nothing on the road moves as the
		// bunch closes on it.
		if held.u-bunchU < protocol.RoadsideStandMinAheadM {
			return "rate_limited", "The riders are nearly at your stand — it stays put until they pass."
		}
		if wait := standMoveEvery - now.Sub(held.movedAt); wait > 0 {
			return "rate_limited", fmt.Sprintf("You moved your stand a moment ago. You can move it again in %d s.", int(math.Ceil(wait.Seconds())))
		}
	}
	b.stands[riderID] = &stand{u: u, movedAt: now}
	b.standsRev++
	return "", ""
}

// settleRoadsideLocked lets go of every stand the bunch has passed, and of
// every spectator's who has left the roadside: gone from the channel, or
// riding the session now. Caller holds rm.mu.
func (rm *channelState) settleRoadsideLocked() {
	b := rm.session.bunch
	if b == nil || len(b.stands) == 0 {
		return
	}
	here := make(map[string]struct{}, len(rm.clients))
	for c := range rm.clients {
		here[c.rider.ID] = struct{}{}
	}
	bunchU := b.fromM + b.pace.Distance
	for id, st := range b.stands {
		if _, present := here[id]; st.u <= bunchU || !present || rm.session.rides(id) {
			delete(b.stands, id)
			b.standsRev++
		}
	}
}

// roadsideState is the roadside as the tick carries it, beside World.
func (b *bunch) roadsideState() *protocol.RoadsideState {
	st := &protocol.RoadsideState{Rev: b.standsRev}
	for id, s := range b.stands {
		m, lap := b.place(s.u)
		st.Stands = append(st.Stands, protocol.RoadsideStand{RiderID: id, AtM: math.Round(m*100) / 100, Lap: lap})
	}
	sort.Slice(st.Stands, func(i, j int) bool { return st.Stands[i].RiderID < st.Stands[j].RiderID })
	return st
}

// roadside is the roadside on the tick while the session rides a road.
func (s *session) roadside() *protocol.RoadsideState {
	if !s.onRoad() {
		return nil
	}
	return s.bunch.roadsideState()
}
