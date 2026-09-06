package auth

// A per-account ceiling on the mail one rider can cause (#827). `PATCH /api/me`
// with a different address on every call was an unbounded stream of "Confirm
// your WattRoom email address" leaving the operator's domain for arbitrary
// inboxes: the resend cooldown in startEmailVerification is keyed on the
// address itself, so changing the address every time walks straight past it.
// Any signed-in account was a mail cannon aimed at our sending reputation.
//
// In memory, like the passkey challenge store and for the same reasons: one
// instance (WATTROOM.md), live state rather than durable data, and a counter
// that forgets on restart is one an attacker has no way to make forget.

import (
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	// Room for a rider fixing a typo several times over, and nowhere near
	// enough to be worth aiming at anyone.
	verifyMailsPerWindow = 10
	verifyMailWindow     = time.Hour
)

// mailBudget counts the verification mails an account has caused inside a
// fixed window.
//
// ponytail: fixed window, not sliding — an account that spends its budget at
// the end of one window and again at the start of the next gets twice the
// ceiling across that boundary. Twenty mails an hour is still not a cannon,
// and a sliding window costs a timestamp slice per account to fix it.
type mailBudget struct {
	mu sync.Mutex
	m  map[pgtype.UUID]budgetWindow
}

type budgetWindow struct {
	count int
	until time.Time
}

func newMailBudget() *mailBudget { return &mailBudget{m: map[pgtype.UUID]budgetWindow{}} }

// spend reports whether this account may cause one more mail right now, and
// counts it when it may.
func (b *mailBudget) spend(user pgtype.UUID) bool {
	now := time.Now()

	b.mu.Lock()
	defer b.mu.Unlock()
	// Swept on write, like the challenge store: the map only grows when
	// somebody asks, so that is the moment worth looking.
	for k, v := range b.m {
		if now.After(v.until) {
			delete(b.m, k)
		}
	}

	w, ok := b.m[user]
	if !ok {
		w = budgetWindow{until: now.Add(verifyMailWindow)}
	}
	if w.count >= verifyMailsPerWindow {
		return false
	}
	w.count++
	b.m[user] = w
	return true
}
