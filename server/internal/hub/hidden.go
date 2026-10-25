package hub

import "github.com/natrontech/wattroom/server/internal/protocol"

// Hider answers whether either of two riders has hidden the other (#3202).
// Hiding never parts a channel: sessions, voice and live numbers stay the
// crew ban's business. What it keeps apart here is the two riders' cheers,
// chalk and pokes.
type Hider interface {
	Hidden(a, b string) bool
}

// SetHider wires the block list in — before the first room opens, since
// rooms capture it at creation, like every other keeper. Nil stays valid.
func (h *Hub) SetHider(k Hider) { h.hider = k }

func (rm *channelState) hides(a, b string) bool {
	return rm.hider != nil && rm.hider.Hidden(a, b)
}

// cheersFor is the tick's cheers as `to` may hear them (#3116, #3202).
func (rm *channelState) cheersFor(to string, cheers []protocol.Cheer, from []string) ([]protocol.Cheer, bool) {
	return hiddenCut(rm.hider, to, cheers, func(i int) (string, string) {
		if i >= len(from) {
			return "", ""
		}
		return from[i], cheers[i].To
	})
}

// roadsideFor is the tick's roadside as `to` may see it (#4152): its chalk
// cut as a cheer is, an initial being chalk aimed at one rider.
func (rm *channelState) roadsideFor(to string, rs *protocol.RoadsideState) (*protocol.RoadsideState, bool) {
	if rs == nil {
		return nil, false
	}
	paint, cut := hiddenCut(rm.hider, to, rs.Paint, func(i int) (string, string) {
		return rs.Paint[i].RiderID, rs.Paint[i].For
	})
	if !cut {
		return rs, false
	}
	own := *rs
	own.Paint = paint
	return &own, true
}

// hiddenCut is a tick's items as `to` may see them: the same slice when
// nothing in it crosses a hidden pair, else a copy without what does. An
// item from a rider hidden from `to` either way is cut. One aimed at a rider
// hidden from its sender is the sender's alone: drawn for nobody else, and
// the sender is never told. `ends` names item i's sender and whom it is aimed
// at ("" for nobody).
func hiddenCut[T any](h Hider, to string, items []T, ends func(i int) (from, at string)) ([]T, bool) {
	if h == nil {
		return items, false
	}
	var own []T
	cut := false
	for i, item := range items {
		from, at := ends(i)
		if from != "" && (h.Hidden(to, from) || (at != "" && to != from && h.Hidden(at, from))) {
			if !cut {
				own, cut = append([]T(nil), items[:i]...), true
			}
			continue
		}
		if cut {
			own = append(own, item)
		}
	}
	if !cut {
		return items, false
	}
	return own, true
}
