package protocol

// RiderMetrics is one rider's live sample, sent client -> server at ~1 Hz.
type RiderMetrics struct {
	Watts   int `json:"watts"`
	HR      int `json:"hr,omitempty"`
	Cadence int `json:"cadence,omitempty"`
	Seq     int `json:"seq"` // monotonic per ride, for reconnect dedup
	// The rider's personal trim on their own targets at this second, 0.8–1.2
	// (docs/SPEC.md). A score answers "did you ride the plan you were on?",
	// and this is what the plan was — so the second is scored against the
	// biased target, not the prescribed one (#795). It rides every sample
	// because bias moves mid-ride, and it is stored with them, which is what
	// lets the saved score agree with the live one.
	//
	// Zero means "not sent": every sample recorded before this existed, and
	// any client that does not send it, scores at 1.0.
	Bias float64 `json:"bias,omitempty"`
	// The WORKOUT second this sample was ridden at (#1733). A solo ride's
	// record counts wall seconds — the ride clock stops while auto-paused,
	// and skip and extend make it jump — so the array index stops being the
	// workout second at the first pause, and every sample after it would be
	// scored against the wrong block.
	//
	// A session ride is stamped with the timeline second (#2814): by the hub
	// on a live sample, which ignores what the client sent, and by the
	// client's buffer on a replayed one, which the hub cannot place
	// otherwise. A rider who joins at minute ten starts at 600, not at 0.
	// Absent (0 on every sample) is a ride recorded before either existed;
	// those score by index.
	Clock int `json:"clock,omitempty"`
	// The rider's own guard had the trainer off the target this second
	// (#1796): auto-pause, the resume countdown, the spiral release. The
	// live meter on the client never scores such a second; the saved ride
	// and the session's live score used to, against the full target — a
	// spiral trip was ten pedalling seconds against no resistance, out of
	// band by construction. Absent means scored.
	Released bool `json:"released,omitempty"`
}

// BiasOr is the trim to score one sample against — 1.0 for a sample that
// carries none, and clamped to what the control can actually produce, so a
// hostile client cannot score itself against a target of its own invention.
// Pedalling is docs/SPEC.md's line between riding and stopped — cadence under
// 5 rpm AND power under 20 W is a stop — the same predicate the client's
// auto-pause uses (web/src/lib/workout/guards.ts). Both scoring paths ask
// this one function, so the live meter and the saved ride exclude the same
// seconds (#795; audit 2026-09-09).
func (m RiderMetrics) Pedalling() bool {
	return m.Cadence >= 5 || m.Watts >= 20
}

func (m RiderMetrics) BiasOr() float64 {
	if m.Bias <= 0 {
		return 1
	}
	return min(max(m.Bias, 0.8), 1.2)
}

// Backfill is a reconnect's replay: samples the client buffered while the
// socket was down (WATTROOM.md crash safety). The server dedupes by Seq, so
// resending is always safe and never double-counts.
type Backfill struct {
	Samples []RiderMetrics `json:"samples"`
}
