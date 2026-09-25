// Package budget is a fixed-window ceiling per key (#827, #1606, #1639): the
// confirmation mail per account, the sign-in doors per address, the session
// mail per room. In memory on purpose: one instance (WATTROOM.md), live state
// rather than durable data, and a counter that forgets on restart is one an
// attacker has no way to make forget.
//
// ponytail: fixed window, not sliding — a key that spends its budget at the
// end of one window and again at the start of the next gets twice the
// ceiling across that boundary. None of these ceilings is a cannon at twice
// its size, and a sliding window costs a timestamp slice per key to fix it.
package budget

import (
	"sync"
	"time"
)

type Budget[K comparable] struct {
	mu     sync.Mutex
	m      map[K]span
	per    int
	window time.Duration
	keep   bool
}

type span struct {
	count int
	until time.Time
}

// maxKeys bounds the map the way challengeMax and handoffMax bound theirs in
// the auth package (#827, #1415, #2254). Several of these ceilings are keyed
// by something a stranger chooses — the recovery door is keyed by the
// address they type into the form — so without a ceiling a loop grows the
// map until the process runs out of memory, and grows the sweep in Spend
// with it, which every other spend waits on behind the same mutex. Far above
// anything real: 4096 distinct keys inside one window.
const maxKeys = 4096

// New is `per` spends per key per `window`, keyed by whoever is asking — an
// account, an address. Full, it makes room by forgetting the key nearest its
// own reset (#2825). That hands one key an early fresh window, which is
// nothing to someone who needed 4096 keys to get it: they already had 4096
// windows. Refusing unseen keys instead locked every new address out of
// sign-in behind a flood of 4096, with a 429 blaming each one's own tries.
func New[K comparable](per int, window time.Duration) *Budget[K] {
	return &Budget[K]{m: map[K]span{}, per: per, window: window}
}

// NewKeeping is New for a ceiling keyed by what it protects rather than by
// who is asking — the inbox a stranger types into the recovery form. There,
// forgetting a key early hands its ceiling straight back to the flood that
// filled the map, so full, it refuses an unseen key instead, and Take says
// that is why.
func NewKeeping[K comparable](per int, window time.Duration) *Budget[K] {
	return &Budget[K]{m: map[K]span{}, per: per, window: window, keep: true}
}

// Spend reports whether this key may spend once more right now, and counts
// it when it may.
func (b *Budget[K]) Spend(key K) bool {
	ok, _ := b.Take(key)
	return ok
}

// Take is Spend that also says why it refused: full is true when a keeping
// budget had no room for an unseen key, rather than the key having spent
// its own ceiling. A full table is a shared resource, not the caller's
// doing, and errors.md answers the two differently (503 against 429).
func (b *Budget[K]) Take(key K) (ok, full bool) {
	now := time.Now()
	b.mu.Lock()
	defer b.mu.Unlock()
	// Swept on write: the map only grows when somebody asks, so that is the
	// moment worth looking — and the one pass finds the key to forget.
	var soonest K
	var soonestAt time.Time
	for k, v := range b.m {
		if now.After(v.until) {
			delete(b.m, k)
		} else if soonestAt.IsZero() || v.until.Before(soonestAt) {
			soonest, soonestAt = k, v.until
		}
	}
	w, seen := b.m[key]
	if !seen {
		// Full after the sweep. A key already in the map still spends either
		// way, so a flood of new keys cannot lift the ceiling off the ones
		// being counted.
		if len(b.m) >= maxKeys {
			if b.keep {
				return false, true
			}
			delete(b.m, soonest)
		}
		w = span{until: now.Add(b.window)}
	}
	if w.count >= b.per {
		return false, false
	}
	w.count++
	b.m[key] = w
	return true, false
}

// Refund gives one spend back — for the thing that was charged for and then
// did not happen (#1643: a mail the transport never sent).
func (b *Budget[K]) Refund(key K) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if w, ok := b.m[key]; ok && w.count > 0 {
		w.count--
		b.m[key] = w
	}
}
