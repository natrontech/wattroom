package hub

import "github.com/natrontech/wattroom/server/internal/protocol"

// Hider answers whether either of two riders has hidden the other (#3202).
// Hiding never parts a channel: sessions, voice and live numbers stay the
// crew ban's business. What it keeps apart here is the two riders' cheers
// and pokes.
type Hider interface {
	Hidden(a, b string) bool
}

// SetHider wires the block list in — before the first room opens, since
// rooms capture it at creation, like every other keeper. Nil stays valid.
func (h *Hub) SetHider(k Hider) { h.hider = k }

func (rm *channelState) hides(a, b string) bool {
	return rm.hider != nil && rm.hider.Hidden(a, b)
}

// cheersFor is the tick's cheers as `to` may hear them: the same slice when
// nothing in it is from a rider hidden either way, else a copy without them.
func (rm *channelState) cheersFor(to string, cheers []protocol.Cheer, from []string) ([]protocol.Cheer, bool) {
	if rm.hider == nil {
		return cheers, false
	}
	var own []protocol.Cheer
	cut := false
	for i, c := range cheers {
		if i < len(from) && rm.hider.Hidden(to, from[i]) {
			if !cut {
				own, cut = append([]protocol.Cheer(nil), cheers[:i]...), true
			}
			continue
		}
		if cut {
			own = append(own, c)
		}
	}
	if !cut {
		return cheers, false
	}
	return own, true
}
