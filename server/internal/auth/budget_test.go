package auth

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestMailBudgetIsPerAccountAndReopens(t *testing.T) {
	b := newMailBudget()
	rider := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	other := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}

	for i := range verifyMailsPerWindow {
		if !b.spend(rider) {
			t.Fatalf("refused at %d, want room for %d", i, verifyMailsPerWindow)
		}
	}
	if b.spend(rider) {
		t.Fatal("spent past the ceiling")
	}
	// One account's spending is not everybody's.
	if !b.spend(other) {
		t.Fatal("a spent account blocked a different one")
	}

	b.mu.Lock()
	w := b.m[rider]
	w.until = time.Now().Add(-time.Second)
	b.m[rider] = w
	b.mu.Unlock()

	if !b.spend(rider) {
		t.Fatal("the window never reopened")
	}
}

// The ceiling has to sit on the path that actually sends, which is the part a
// unit test of the counter cannot prove.
func TestVerificationMailStopsAtTheCeiling(t *testing.T) {
	s := testService(t)
	mailer := &fakeMailer{}
	s.SetMailer(mailer)
	user := testUser(t, s)

	// A different address every time is what walks past the same-address
	// resend cooldown — the hole the ceiling exists to close.
	for i := range verifyMailsPerWindow {
		if _, err := s.startEmailVerification(t.Context(), user, fmt.Sprintf("rider%d@example.test", i)); err != nil {
			t.Fatalf("start %d: %v", i, err)
		}
	}
	if _, err := s.startEmailVerification(t.Context(), user, "one-too-many@example.test"); !errors.Is(err, errTooManyVerifications) {
		t.Fatalf("err = %v, want the ceiling", err)
	}
	if mailer.calls != verifyMailsPerWindow {
		t.Fatalf("sent %d mails, want %d", mailer.calls, verifyMailsPerWindow)
	}
}
