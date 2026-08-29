package hub

import "github.com/natrontech/wattroom/server/internal/protocol"

// Limits on what one rider can make the room remember. Six hours at 1 Hz is
// longer than any session; past it (or a hostile client), samples drop rather
// than growing server memory unboundedly.
const (
	maxAccumulated   = 6 * 60 * 60
	maxBackfillBatch = 600
)

// accumulator is one session's ride record per rider, in memory like all live
// state. It exists so a reconnect has somewhere to land its replay: live
// metrics and backfilled samples arrive through the same door and dedupe by
// seq, so a resend never double-counts. The stats pipeline (#25) reads this
// on session end; until then it is the room's only memory of the ride.
//
// Not goroutine-safe on its own — the owning room's mutex guards it.
type accumulator struct {
	byRider map[string]*riderRecord
}

type riderRecord struct {
	seen    map[int]struct{}
	samples []protocol.RiderMetrics
}

func newAccumulator() *accumulator {
	return &accumulator{byRider: make(map[string]*riderRecord)}
}

// add records one sample; duplicates by seq are dropped silently — that is
// the point of them.
func (a *accumulator) add(riderID string, m protocol.RiderMetrics) {
	record, ok := a.byRider[riderID]
	if !ok {
		record = &riderRecord{seen: make(map[int]struct{})}
		a.byRider[riderID] = record
	}
	if _, dup := record.seen[m.Seq]; dup {
		return
	}
	if len(record.samples) >= maxAccumulated {
		return
	}
	record.seen[m.Seq] = struct{}{}
	record.samples = append(record.samples, m)
}

func (a *accumulator) count(riderID string) int {
	if record, ok := a.byRider[riderID]; ok {
		return len(record.samples)
	}
	return 0
}

// reset starts a fresh record — a new session is a new ride.
func (a *accumulator) reset() {
	a.byRider = make(map[string]*riderRecord)
}
