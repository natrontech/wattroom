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

// New is `per` spends per key per `window`.
func New[K comparable](per int, window time.Duration) *Budget[K] {
	return &Budget[K]{m: map[K]span{}, per: per, window: window}
}

// Spend reports whether this key may spend once more right now, and counts
// it when it may.
func (b *Budget[K]) Spend(key K) bool {
	now := time.Now()
	b.mu.Lock()
	defer b.mu.Unlock()
	// Swept on write: the map only grows when somebody asks, so that is the
	// moment worth looking.
	for k, v := range b.m {
		if now.After(v.until) {
			delete(b.m, k)
		}
	}
	w, ok := b.m[key]
	if !ok {
		// Full after the sweep. A key already in the map still spends, so a
		// flood of new keys cannot lift the ceiling off the ones being
		// counted; an unseen key is refused rather than admitted. The
		// caller's refusal is "wait, then try again" (errors.md), which is
		// the truth — 4096 distinct keys inside one window is the attack,
		// not a busy evening.
		if len(b.m) >= maxKeys {
			return false
		}
		w = span{until: now.Add(b.window)}
	}
	if w.count >= b.per {
		return false
	}
	w.count++
	b.m[key] = w
	return true
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
