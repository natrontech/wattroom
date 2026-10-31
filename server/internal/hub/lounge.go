package hub

import (
	"slices"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// loungeMinGap bounds how often one rider may flip the lounge. It is a tap
// with nothing to answer (errors.md, fire-and-forget), so one over the limit
// drops in silence.
const loungeMinGap = 250 * time.Millisecond

// lounge takes a rider's flip of the lamp or the weather (ADR-0094). Anyone in
// the channel may: like the roadside, it paints and never reaches a ride.
func (h *Hub) lounge(rm *channelState, rider protocol.Rider, want protocol.LoungeState) {
	if rm.allow("lounge", rider.ID, h.now(), loungeMinGap) {
		rm.setLounge(want)
	}
}

// setLounge stores what the scene should show. Rain is the default and so the
// zero value; a weather outside the closed set leaves the window as it was.
func (rm *channelState) setLounge(want protocol.LoungeState) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if !slices.Contains(protocol.LoungeWeathers, want.Weather) {
		want.Weather = rm.lounge.Weather
	}
	if want.Weather == "rain" {
		want.Weather = ""
	}
	rm.lounge = want
}

// loungeLocked is the tick's copy: nothing while the scene is as it opens.
func (rm *channelState) loungeLocked() *protocol.LoungeState {
	if rm.lounge == (protocol.LoungeState{}) {
		return nil
	}
	return new(rm.lounge)
}
