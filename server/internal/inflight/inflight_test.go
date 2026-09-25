package inflight

import (
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func uuid(b byte) pgtype.UUID {
	var id pgtype.UUID
	id.Bytes[0] = b
	id.Valid = true
	return id
}

// The guard's own semantics, without a database in the way. Every case is a
// sequence of moves against one set, because the bug worth catching here is a
// state one: a slot that is never handed back locks a rider out of their own
// data for the life of the process.
func TestInFlightSlotIsOnePerAccount(t *testing.T) {
	alice, bob := uuid(1), uuid(2)

	for _, tc := range []struct {
		name string
		run  func(t *testing.T, f *Set)
	}{
		{"a second export for the same account is refused", func(t *testing.T, f *Set) {
			if !f.Acquire(alice) {
				t.Fatal("the first export was refused the slot")
			}
			if f.Acquire(alice) {
				t.Error("a second export took the slot while the first held it")
			}
		}},
		{"the slot comes back on release", func(t *testing.T, f *Set) {
			if !f.Acquire(alice) {
				t.Fatal("first acquire refused")
			}
			f.Release(alice)
			if f.Running(alice) {
				t.Error("still marked running after release")
			}
			if !f.Acquire(alice) {
				t.Error("the slot did not come back after release")
			}
		}},
		{"one rider's export does not block another's", func(t *testing.T, f *Set) {
			if !f.Acquire(alice) || !f.Acquire(bob) {
				t.Fatal("two accounts should hold a slot each")
			}
			f.Release(alice)
			if !f.Running(bob) {
				t.Error("releasing alice's slot took bob's")
			}
		}},
		{"a panic hands the slot back", func(t *testing.T, f *Set) {
			// The handler's shape: acquire, then `defer release`. This is the
			// path that would otherwise leak, and the reason release is
			// deferred rather than called at the end of the happy path.
			func() {
				defer func() { _ = recover() }()
				if !f.Acquire(alice) {
					t.Fatal("acquire refused")
				}
				defer f.Release(alice)
				panic("export blew up")
			}()
			if f.Running(alice) {
				t.Fatal("a panic leaked the slot — this rider is locked out until restart")
			}
			if !f.Acquire(alice) {
				t.Error("the slot did not come back after a panic")
			}
		}},
		{"release is idempotent and minds its own key", func(t *testing.T, f *Set) {
			if !f.Acquire(alice) {
				t.Fatal("acquire refused")
			}
			f.Release(bob) // never held one
			if !f.Running(alice) {
				t.Error("releasing a key that held nothing freed alice's slot")
			}
			f.Release(alice)
			f.Release(alice) // a double defer must not be a second free
			if f.Running(alice) {
				t.Error("still running after release")
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.run(t, New())
		})
	}
}

// Exactly one of many simultaneous exports gets the slot — the double-click
// this ceiling exists for, run under -race.
func TestInFlightGivesTheSlotToExactlyOneCaller(t *testing.T) {
	f := New()
	alice := uuid(1)

	const callers = 50
	var start sync.WaitGroup
	var done sync.WaitGroup
	start.Add(1)
	var mu sync.Mutex
	won := 0
	for range callers {
		done.Add(1)
		go func() {
			defer done.Done()
			start.Wait()
			if f.Acquire(alice) {
				mu.Lock()
				won++
				mu.Unlock()
			}
		}()
	}
	start.Done()
	done.Wait()

	if won != 1 {
		t.Errorf("%d callers got the slot, want exactly 1", won)
	}
}
