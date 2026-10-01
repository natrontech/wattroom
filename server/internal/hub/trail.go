package hub

// trail is where each rider stood along a road at the end of each timeline
// second (#3722, #3738): written as the road is ridden, the tick at second e
// having ridden second e-1, and read back by a saved sample's own second.
// A second nothing wrote holds the last place written, and a second before
// the first the first, so a rider's trail has no holes.
type trail map[string]*places

type places struct {
	from int
	at   []float64
}

// write puts a rider at u, laps unrolled, at the end of the second just
// ridden by the tick at elapsed.
func (t trail) write(id string, elapsed int, u float64) {
	second := max(elapsed-1, 0)
	p := t[id]
	if p == nil {
		p = &places{from: second}
		t[id] = p
	}
	i := second - p.from
	if i < 0 {
		return
	}
	for len(p.at) <= i {
		last := u
		if len(p.at) > 0 {
			last = p.at[len(p.at)-1]
		}
		p.at = append(p.at, last)
	}
	p.at[i] = u
}

// at is where a rider stood at the end of a second, and false for one never
// written.
func (t trail) at(id string, second int) (float64, bool) {
	p := t[id]
	if p == nil || len(p.at) == 0 {
		return 0, false
	}
	return p.at[min(max(second-p.from, 0), len(p.at)-1)], true
}

// span is the first and the last place a rider was written at.
func (t trail) span(id string) (first, last float64, ok bool) {
	p := t[id]
	if p == nil || len(p.at) == 0 {
		return 0, 0, false
	}
	return p.at[0], p.at[len(p.at)-1], true
}
