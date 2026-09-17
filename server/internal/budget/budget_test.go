package budget

import (
	"testing"
	"time"
)

func TestSpendAndRefund(t *testing.T) {
	b := New[string](2, time.Hour)
	for i := 0; i < 2; i++ {
		if !b.Spend("a") {
			t.Fatalf("spend %d should be free", i)
		}
	}
	if b.Spend("a") {
		t.Fatal("the third spend is over the ceiling")
	}
	if !b.Spend("b") {
		t.Fatal("another key has its own window")
	}
	b.Refund("a")
	if !b.Spend("a") {
		t.Fatal("a refund gives the spend back")
	}
	b.Refund("nobody") // a refund for a key that never spent is nothing
}

// The map is the thing being bounded (#2254). Several of these ceilings are
// keyed by something a stranger chooses — the recovery door by the address
// they type — so an unbounded map is a loop away from the process running
// out of memory, and from a sweep every other spend waits on behind the same
// mutex. Its two neighbours in the auth package were capped for exactly this
// and say so; this one never was.
func TestSpendRefusesPastTheCap(t *testing.T) {
	b := New[int](1, time.Hour)
	for i := range maxKeys {
		if !b.Spend(i) {
			t.Fatalf("key %d was refused below the cap", i)
		}
	}
	if b.Spend(maxKeys + 1) {
		t.Error("a key past the cap was admitted, so the map has no ceiling")
	}
	if len(b.m) != maxKeys {
		t.Errorf("map holds %d keys, want %d", len(b.m), maxKeys)
	}

	// A key already counted keeps its own ceiling — a flood of new keys must
	// not lift it, and must not hand a key that has spent its budget a fresh
	// one either.
	if b.Spend(0) {
		t.Error("a key that spent its budget got another under a full map")
	}
	b.Refund(0)
	if !b.Spend(0) {
		t.Error("a key already in the map stopped spending because the map is full")
	}

	// The window is what frees it: expired spans go in the sweep, and the
	// next stranger is let in again.
	short := New[int](1, 0)
	for i := range maxKeys {
		if !short.Spend(i) {
			t.Fatalf("key %d was refused below the cap", i)
		}
	}
	if !short.Spend(maxKeys + 1) {
		t.Error("expired keys were not swept, so one window's flood is permanent")
	}
}
