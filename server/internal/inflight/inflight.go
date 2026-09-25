// Package inflight is the ceiling for work whose cost is concurrent: one run
// per account at a time. The data export was first (#1554), a track upload
// second (#2862).
package inflight

import (
	"sync"

	"github.com/jackc/pgx/v5/pgtype"
)

// Set is the ceiling: one run per account at a time — one export (#1554),
// one track upload (#2862).
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
// locked out by across one. The zero value is ready to use.
type Set struct {
	mu  sync.Mutex
	ids map[pgtype.UUID]struct{}
}

// Acquire reports whether this account may start one now, and marks it
// running when it may. The caller that gets true owes exactly one release.
func (f *Set) Acquire(id pgtype.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, running := f.ids[id]; running {
		return false
	}
	if f.ids == nil {
		f.ids = map[pgtype.UUID]struct{}{}
	}
	f.ids[id] = struct{}{}
	return true
}

// Release hands the slot back. Idempotent, and safe for a key that never held
// one — deleting an absent key is a no-op — so a defer can never be the thing
// that breaks. No sweep either, unlike budget: an entry lives only as long as
// the request holding it, so the map is bounded by what is running right now
// rather than by every account that ever asked.
func (f *Set) Release(id pgtype.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.ids, id)
}

// Running reports whether one is in flight for this account. Tests only:
// the leak this guards against is invisible from the outside until a rider is
// already locked out.
func (f *Set) Running(id pgtype.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.ids[id]
	return ok
}
