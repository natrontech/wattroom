package hub

import (
	"math"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
)

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
	if !record.keep(m) {
		return
	}

	if segments == nil || ftp <= 0 || m.Watts <= 0 {
		return
	}
	target, scored := workout.TargetAt(segments, ftp, second)
	if !scored || target <= 0 {
		return
	}
	band := math.Max(target*0.05, 10)
	wgt := target / ftp
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

// execution is the live score so far; 1 until anything scored, like the SPEC
// pipeline — a meter at 0 before the first hard block reads as failure.
func (a *accumulator) execution(riderID string) float64 {
	record, ok := a.byRider[riderID]
	if !ok || record.weight == 0 {
		return 1
	}
	return record.inBand / record.weight
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
