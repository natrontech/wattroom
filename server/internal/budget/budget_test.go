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
//
// Full, it makes room rather than refusing (#2825): refusing every unseen
// key turned 4096 addresses inside a minute into a sign-in lockout for every
// address after them, with a 429 that blamed each one's own attempts.
func TestSpendMakesRoomPastTheCap(t *testing.T) {
	b := New[int](1, time.Hour)
	now := time.Now()
	for i := range maxKeys {
		b.m[i] = span{count: 1, until: now.Add(time.Hour + time.Duration(i)*time.Second)}
	}
	const soonest = 7
	b.m[soonest] = span{count: 1, until: now.Add(time.Minute)}

	if !b.Spend(-1) {
		t.Fatal("an unseen key was refused because the map is full, so a flood of keys locks out every new one")
	}
	if len(b.m) != maxKeys {
		t.Errorf("map holds %d keys, want %d", len(b.m), maxKeys)
	}
	if _, kept := b.m[soonest]; kept {
		t.Error("the room was not made by the key nearest its own reset")
	}
	// The keys still counted keep their ceiling.
	if b.Spend(0) {
		t.Error("a key that spent its budget got another under a full map")
	}
}

// A keeping budget is keyed by what it protects — the inbox a stranger
// types — so forgetting a key early hands its ceiling back to the flood
// that filled the map. Full, it refuses an unseen key, and says that is why:
// the caller answers "busy", not "you asked too often" (errors.md).
func TestKeepingRefusesPastTheCapAndSaysSo(t *testing.T) {
	b := NewKeeping[int](1, time.Hour)
	for i := range maxKeys {
		if !b.Spend(i) {
			t.Fatalf("key %d was refused below the cap", i)
		}
	}
	if ok, full := b.Take(maxKeys + 1); ok || !full {
		t.Errorf("an unseen key past the cap: ok %v full %v, want refused as full", ok, full)
	}
	if len(b.m) != maxKeys {
		t.Errorf("map holds %d keys, want %d", len(b.m), maxKeys)
	}
	// A key over its own ceiling is refused for that, not for the map.
	if ok, full := b.Take(0); ok || full {
		t.Errorf("a key that spent its budget: ok %v full %v, want refused, not full", ok, full)
	}
	b.Refund(0)
	if !b.Spend(0) {
		t.Error("a key already in the map stopped spending because the map is full")
	}

	// The window is what frees it: expired spans go in the sweep, and the
	// next stranger is let in again.
	short := NewKeeping[int](1, 0)
	for i := range maxKeys {
		if !short.Spend(i) {
			t.Fatalf("key %d was refused below the cap", i)
		}
	}
	if !short.Spend(maxKeys + 1) {
		t.Error("expired keys were not swept, so one window's flood is permanent")
	}
}
