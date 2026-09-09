package hub

import (
	"math"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// Limits on what one rider can make the room remember. Six hours at 1 Hz is
// longer than any session; past it (or a hostile client), samples drop rather
// than growing server memory unboundedly. A replay carries one sample a
// second (the client buffers no faster), so one batch holds an hour's drop —
// at 600 a ten-minute outage was silently cut to its oldest ten minutes
// (audit 2026-09-09).
const (
	maxAccumulated   = 6 * 60 * 60
	maxBackfillBatch = 60 * 60
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

// seqKey is what a seq is unique WITHIN (#522). A client's counter restarts
// whenever its page does — a reload, or a re-paired trainer — and seq alone
// as the key made every sample after such a restart collide with one already
// recorded and vanish. Live tiles kept moving (they never consult the record),
// so the loss showed up only in the saved ride and the frozen execution meter.
type seqKey struct {
	stream int
	seq    int
}

type riderRecord struct {
	seen    map[seqKey]struct{}
	samples []protocol.RiderMetrics
	// The live stream this record is on, and the last seq it carried. A live
	// stream is monotonic per client session, so a seq that fails to advance
	// is a client that started over — never a duplicate.
	stream  int
	lastSeq int
	started bool
	// The last timeline second this record admitted a LIVE sample for, and
	// whether it has admitted one at all. A second cannot elapse twice (#791):
	// notifications arrive irregularly — a trainer that bursts, a tab that
	// wakes and flushes — and the ride record counts one entry as one second
	// (stats.BuildRideRow's len(samples)). Sixty packets inside one second
	// used to be sixty seconds of riding.
	lastSecond int
	secondSet  bool
	// Live execution (#27): the SPEC score accumulated as samples arrive, so
	// the tick can carry every rider's compliance without rescoring history.
	weight float64
	inBand float64
}

func newAccumulator() *accumulator {
	return &accumulator{byRider: make(map[string]*riderRecord)}
}

func (a *accumulator) recordFor(riderID string) *riderRecord {
	record, ok := a.byRider[riderID]
	if !ok {
		record = &riderRecord{seen: make(map[seqKey]struct{})}
		a.byRider[riderID] = record
	}
	return record
}

// keep admits one sample under the dedupe and the memory bound; false means
// it was already recorded, or the record is full.
func (r *riderRecord) keep(m protocol.RiderMetrics) bool {
	key := seqKey{stream: r.stream, seq: m.Seq}
	if _, dup := r.seen[key]; dup {
		return false
	}
	if len(r.samples) >= maxAccumulated {
		return false
	}
	r.seen[key] = struct{}{}
	r.samples = append(r.samples, m)
	return true
}

// add records one LIVE sample. segments/ftp/second score it live (#27): nil
// segments (no workout) records without scoring — the authoritative score
// lands at save time.
func (a *accumulator) add(riderID string, m protocol.RiderMetrics, segments []workout.Segment, ftp float64, second int) {
	record := a.recordFor(riderID)
	// A seq that does not advance is a fresh client, not a resend: the socket
	// delivers one session's samples in order, so only a restart can go back.
	if record.started && m.Seq <= record.lastSeq {
		record.stream++
	}
	record.started, record.lastSeq = true, m.Seq
	// One sample per timeline second, admitted against the ROOM's clock (#791).
	// The client's sequence number is proof that it sent something, never that
	// a second passed — and the record is read as one-sample-per-second by
	// everything downstream. The live tiles are not affected: they read the
	// latest metrics, not this record.
	if record.secondSet && second <= record.lastSecond {
		return
	}
	record.lastSecond, record.secondSet = second, true
	if !record.keep(m) {
		return
	}

	// A released second (#1796) is the rider's guard at work, not a miss.
	if segments == nil || ftp <= 0 || !m.Pedalling() || m.Released {
		return
	}
	target, scored := workout.TargetAt(segments, ftp, second)
	if !scored || target <= 0 {
		return
	}
	// Against the rider's OWN target: bias is "this is the plan I am on
	// today", and the score answers whether they rode the plan they were on
	// (#795). The weight stays the prescribed intensity, so dialling down
	// does not also quietly reduce how much that second counts for.
	wgt := target / ftp
	target *= m.BiasOr()
	band := math.Max(target*0.05, 10)
	record.weight += wgt
	if math.Abs(float64(m.Watts)-target) <= band {
		record.inBand += wgt
	}
}

// replay records one BACKFILLED sample: a reconnect resending what it already
// sent, which is the one place a seq legitimately goes backwards. It stays on
// the stream it was sent on, so the overlap still dedupes away, and it never
// scores — a replayed sample's timeline second is unknown (#19).
func (a *accumulator) replay(riderID string, m protocol.RiderMetrics) {
	a.recordFor(riderID).keep(m)
}

// execution is the live score so far, and whether anything has scored yet.
// Before the first scorable second there is no score: the meter used to say
// 100 % then, and the saved ride said 0 % for the same session — a rider
// whose trainer reported no power watched a perfect meter all session and
// was handed nothing (audit 2026-09-09). Unscored is left out of the tick,
// and the client draws a dash.
func (a *accumulator) execution(riderID string) (score float64, scored bool) {
	record, ok := a.byRider[riderID]
	if !ok || record.weight == 0 {
		return 0, false
	}
	return record.inBand / record.weight, true
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
