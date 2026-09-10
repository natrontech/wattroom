package account

import (
	"sync"

	"github.com/jackc/pgx/v5/pgtype"
)

// inFlight is the export ceiling (#1554): one export per account at a time.
//
// Deliberately not budget.Budget, which is the app's other ceiling shape. That
// one is a fixed window, and a window is the thing this ceiling must not have:
// it would refuse a rider whose previous export already finished, and being
// fair about that needs a last-export timestamp the app does not keep
// anywhere. What the export actually costs is concurrent — every ride blob the
// rider owns, read and gunzipped per call — so concurrency is the unit to
// spend, and a rider who waits for their download is never told no.
//
// In memory and per process, like every other live-state ceiling here
// (ADR-0002 is one VM): a set that forgets on restart is one nobody can be
// locked out by across one.
type inFlight struct {
	mu  sync.Mutex
	ids map[pgtype.UUID]struct{}
}

func newInFlight() *inFlight { return &inFlight{ids: map[pgtype.UUID]struct{}{}} }

// acquire reports whether this account may start an export now, and marks it
// running when it may. The caller that gets true owes exactly one release.
func (f *inFlight) acquire(id pgtype.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, running := f.ids[id]; running {
		return false
	}
	f.ids[id] = struct{}{}
	return true
}

// release hands the slot back. Idempotent, and safe for a key that never held
// one — deleting an absent key is a no-op — so a defer can never be the thing
// that breaks. No sweep either, unlike budget: an entry lives only as long as
// the request holding it, so the map is bounded by exports running right now
// rather than by every account that ever asked.
func (f *inFlight) release(id pgtype.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.ids, id)
}

// running reports whether an export is in flight for this account. Tests only:
// the leak this guards against is invisible from the outside until a rider is
// already locked out.
func (f *inFlight) running(id pgtype.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.ids[id]
	return ok
}
