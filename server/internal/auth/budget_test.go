package auth

import (
	"github.com/jackc/pgx/v5/pgtype"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/budget"
)

// The ceiling on the mail one account can cause (#827), and the window
// turning — the mechanics live in package budget now, shared with the
// sign-in doors and the session mail.
func testUUID(n byte) pgtype.UUID { return pgtype.UUID{Bytes: [16]byte{n}, Valid: true} }

func TestMailBudget(t *testing.T) {
	b := newMailBudget()
	user := testUUID(1)
	for i := 0; i < verifyMailsPerWindow; i++ {
		if !b.Spend(user) {
			t.Fatalf("spend %d refused inside the window", i)
		}
	}
	if b.Spend(user) {
		t.Fatal("one past the ceiling was allowed")
	}
	if !b.Spend(testUUID(2)) {
		t.Fatal("another account has its own window")
	}

	short := budget.New[string](1, 200*time.Millisecond)
	if !short.Spend("k") || short.Spend("k") {
		t.Fatal("one spend per window")
	}
	time.Sleep(400 * time.Millisecond)
	if !short.Spend("k") {
		t.Fatal("the window did not turn")
	}
}
