package road

// Reading a stored road by distance (#3053): the height and grade at a metre,
// and what a stretch of it climbs. Between samples the road is straight, the
// way $lib/road stored it.

// Step is the metres between the road's samples.
func (r Road) Step() float64 { return r.LengthM / float64(len(r.Heights)-1) }

// HeightAt is the road's height m metres along it, clamped to its ends.
func (r Road) HeightAt(m float64) float64 {
	i, t := r.segment(m)
	return r.Heights[i] + (r.Heights[i+1]-r.Heights[i])*t
}

// GradeAt is the grade, in percent, of the stretch m metres along the road.
func (r Road) GradeAt(m float64) float64 {
	i, _ := r.segment(m)
	return (r.Heights[i+1] - r.Heights[i]) / r.Step() * 100
}

// ClimbedBetween is the metres of ascent from `from` to `to` along the road:
// every rise counted, no descent taken off.
func (r Road) ClimbedBetween(from, to float64) float64 {
	if to <= from {
		return 0
	}
	step := r.Step()
	climbed := 0.0
	prev := r.HeightAt(from)
	for i := int(from/step) + 1; float64(i)*step < to && i < len(r.Heights); i++ {
		climbed += max(0, r.Heights[i]-prev)
		prev = r.Heights[i]
	}
	return climbed + max(0, r.HeightAt(to)-prev)
}

// segment is the sample a metre falls after, and how far towards the next.
func (r Road) segment(m float64) (int, float64) {
	step := r.Step()
	m = min(max(m, 0), r.LengthM)
	i := min(int(m/step), len(r.Heights)-2)
	return i, (m - float64(i)*step) / step
}
