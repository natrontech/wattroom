package hub

import (
	"math"
	"sort"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Free riders on one road see each other (#3117, ADR-0059): the audience is
// the voice channel, as for every free ride's numbers, and within it only
// riders on the same road, whose frames alone carry it (tick_frames.go).
// Each rider's own samples move them; the hub runs no physics for them. A
// road key never leaves the hub, and a road one rider rides alone sends
// nothing at all.

// roadPresence is where one socket's free ride is on a road. Separate from
// the socket's device role and trainer claim (pairing.go): it says which
// road, never which screen.
type roadPresence struct {
	// The road's key, as protocol.FreeRoad carries it; empty off a road.
	key string
	// Metres along it at this socket's last sample, once one has said.
	m      float64
	placed bool
}

// validRoadKey is a SHA-256 in lowercase hex, the only key a client sends.
func validRoadKey(key string) bool {
	if len(key) != protocol.FreeRoadKeyLen {
		return false
	}
	for _, r := range key {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

// setFreeRoad records the road this socket free-rides, or that it left one.
// Untrusted input bounded at the boundary: a key that is not one is
// dropped. One field per socket, so unlimited like the drive.
func (rm *channelState) setFreeRoad(c *client, key string) {
	if key != "" && !validRoadKey(key) {
		return
	}
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if c.road.key != key {
		c.road = roadPresence{key: key}
	}
}

// heardOnRoadLocked places a socket on its road from a live sample. Caller
// holds rm.mu.
func (c *client) heardOnRoadLocked(m protocol.RiderMetrics) {
	if c.road.key != "" {
		c.road.m, c.road.placed = m.M, true
	}
}

// freeRoadsLocked is the tick's FreeRoads: every free rider whose road
// another free rider here rides too, the road numbered for this tick alone.
// A rider in the session rides its bunch, not a road of their own. Caller
// holds rm.mu.
func (rm *channelState) freeRoadsLocked() map[string]protocol.FreeRoadPlace {
	on := make(map[string]roadPresence)
	for c := range rm.clients {
		// Only the screen holding the trainer is placed: one the claim moved
		// away from keeps its last metre, and must not stand in for it.
		if c.road.placed && rm.ownsTrainerLocked(c) && !rm.session.rides(c.rider.ID) {
			on[c.rider.ID] = c.road
		}
	}
	riders := make(map[string]int)
	for _, p := range on {
		riders[p.key]++
	}
	shared := make([]string, 0, len(riders))
	for key, n := range riders {
		if n > 1 {
			shared = append(shared, key)
		}
	}
	if len(shared) == 0 {
		return nil
	}
	sort.Strings(shared)
	number := make(map[string]int, len(shared))
	for i, key := range shared {
		number[key] = i + 1
	}
	out := make(map[string]protocol.FreeRoadPlace)
	for id, p := range on {
		if n := number[p.key]; n > 0 {
			out[id] = protocol.FreeRoadPlace{Road: n, M: math.Round(p.m*10) / 10}
		}
	}
	return out
}

// onRoad is the tick's FreeRoads cut to the riders on road n, the frame a
// rider on it is sent; nil for 0, a rider on no shared road.
func onRoad(all map[string]protocol.FreeRoadPlace, n int) map[string]protocol.FreeRoadPlace {
	if n == 0 {
		return nil
	}
	out := make(map[string]protocol.FreeRoadPlace)
	for id, p := range all {
		if p.Road == n {
			out[id] = p
		}
	}
	return out
}
