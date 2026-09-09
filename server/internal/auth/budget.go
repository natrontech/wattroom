package auth

// The per-account ceiling on the mail one rider can cause (#827): `PATCH
// /api/me` with a different address on every call was an unbounded stream
// of "Confirm your WattRoom email address" leaving the operator's domain for
// arbitrary inboxes — the resend cooldown is keyed on the address itself, so
// changing it every time walks straight past it. The window itself lives in
// package budget, shared with the sign-in doors and the session mail.

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/natrontech/wattroom/server/internal/budget"
)

const (
	// Room for a rider fixing a typo several times over, and nowhere near
	// enough to be worth aiming at anyone.
	verifyMailsPerWindow = 10
	verifyMailWindow     = time.Hour
)

type mailBudget = budget.Budget[pgtype.UUID]

func newMailBudget() *mailBudget {
	return budget.New[pgtype.UUID](verifyMailsPerWindow, verifyMailWindow)
}
