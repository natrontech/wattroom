package hub

import (
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/textx"
)

// voiceKind is the claim kind that says which of a rider's screens carries
// their voice and camera (ADR-0089). It lives beside the sensor kinds in
// rm.claims, so it is released, told and scoped exactly as a trainer is
// (ADR-0025), but a sensor claim never names it and so never releases it.
const voiceKind = "voice"

// claimVoice records which of a rider's tabs carries their voice. First
// claim wins; take moves it to this tab. It reports whether the holder
// changed, and whether this tab carries the voice now.
func (rm *channelState) claimVoice(c *client, claim protocol.VoiceClaim) (changed, here bool) {
	// Bounded the way a sensor claim is: both strings are stored per socket.
	claim.Tab = textx.Clip(claim.Tab, 64)
	claim.Device = textx.Clip(claim.Device, 16)

	rm.mu.Lock()
	defer rm.mu.Unlock()
	tab := claim.Tab
	if tab == "" {
		tab = c.tab
	}
	if tab == "" {
		tab = c.tabFallback()
	}
	c.tab = tab
	if claim.Device != "" {
		c.device = claim.Device
	}

	if rm.claims == nil {
		rm.claims = make(map[string]map[string]holder)
	}
	held := rm.claims[c.rider.ID]
	if held == nil {
		held = make(map[string]holder)
		rm.claims[c.rider.ID] = held
	}
	defer func() {
		if len(held) == 0 {
			delete(rm.claims, c.rider.ID)
		}
	}()

	owner, taken := held[voiceKind]
	mine := taken && owner.tab == tab
	switch {
	case claim.On && (mine || !taken || claim.Take):
		next := holder{tab: tab, device: c.device}
		if taken && owner == next {
			return false, true
		}
		held[voiceKind] = next
		return true, true
	case claim.On:
		return false, false
	case mine:
		delete(held, voiceKind)
		return true, false
	}
	return false, false
}

// voiceElsewhereLocked is the device word of the rider's screen carrying
// their voice, for the refusal a second screen hears.
func (rm *channelState) voiceElsewhereLocked(riderID string) string {
	if owner, taken := rm.claims[riderID][voiceKind]; taken && owner.device != "" {
		return owner.device
	}
	return "other device"
}

// voiceClaim takes a VoiceClaim from a socket. A refused claim answers with
// voice_conflict, which the client turns into the controller view; every
// screen of the rider then hears where the voice is through its pairing.
func (h *Hub) voiceClaim(c *client, rm *channelState, rider protocol.Rider, claim protocol.VoiceClaim) {
	changed, here := rm.claimVoice(c, claim)
	if claim.On && !here {
		rm.mu.Lock()
		where := rm.voiceElsewhereLocked(rider.ID)
		rm.mu.Unlock()
		h.writeError(c, "voice_conflict", "Your voice is on your "+where+". Use this device for voice to move it here.")
	}
	if changed || claim.On {
		rm.announcePairing(rider.ID)
	}
}
