package secrets

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/metrics"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// The gauge's failure mode is silence: a count that is right and a collector
// nobody serves reads exactly like sealing being complete. That is #2321/#2322
// verbatim — wattroom_room_riding was registered, correct, and absent from the
// endpoint for two releases — so this asserts the number on the SERVED page,
// not the number Observe returns.
func TestTheCountReachesTheServedMetricsPage(t *testing.T) {
	st := storetest.Open(t)

	n, err := Observe(t.Context(), st.Queries)
	if err != nil {
		t.Fatalf("Observe: %v", err)
	}

	rec := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("metrics = %d", rec.Code)
	}
	want := fmt.Sprintf("wattroom_identities_plaintext_refresh_tokens %d", n)
	if !strings.Contains(rec.Body.String(), want) {
		t.Fatalf("the metrics page does not carry %q.\n"+
			"An operator reads this number instead of opening psql against the live database (#1038); a gauge that is set but not served tells them nothing.\n"+
			"page:\n%s", want, rec.Body.String())
	}
}

// What the number means, one row shape at a time.
//
// Per shape rather than one delta over all of them, because two predicate
// mistakes cancelled: swapping `refresh_token <> the empty string` for
// `refresh_token_enc is null` loses the row sealed beside a live plaintext
// copy and gains the row holding the empty string, and an aggregate count
// comes back with the same total. The delta each shape makes on its own is
// what the gauge actually claims.
//
// Inside one REPEATABLE READ transaction, rolled back: the count is global to
// `identities` and `go test ./...` runs packages in parallel against one
// database (AGENTS.md — per-checkout is not per-package), so a delta taken on
// the pool would be another package's users being created and deleted as much
// as it is this test's rows. One snapshot makes each delta exactly the row
// this test just wrote.
func TestTheCountIsPlaintextTokensAndNothingElse(t *testing.T) {
	st := storetest.Open(t)

	tx, err := st.Pool.BeginTx(t.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(t.Context()) }()
	q := db.New(tx)

	sealed, err := configured(t).Seal("a-sealed-token")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	plain := func(s string) *string { return &s }
	for _, row := range []struct {
		name  string
		token *string
		enc   []byte
		adds  int64
	}{
		{name: "in the clear", token: plain("a-plaintext-token"), adds: 1},
		// Why this predicate is not the one ListPlaintextRefreshTokens uses:
		// that one skips a row with a sealed column because it has no work
		// left to do, and this row is still a live credential in a pg_dump.
		{name: "in the clear beside a sealed copy", token: plain("a-plaintext-token"), enc: sealed, adds: 1},
		{name: "sealed", enc: sealed},
		// A provider that returned no refresh token has always written the
		// empty string, never null — dropping the column costs that row
		// nothing, so it must not hold the drop up.
		{name: "empty string", token: plain("")},
		{name: "null", token: nil},
	} {
		t.Run(row.name, func(t *testing.T) {
			before, err := Observe(t.Context(), q)
			if err != nil {
				t.Fatalf("Observe: %v", err)
			}
			user, err := q.CreateUser(t.Context(), db.CreateUserParams{DisplayName: "seal " + row.name, FtpWatts: 200, WeightKg: 75})
			if err != nil {
				t.Fatalf("create user: %v", err)
			}
			if err := q.CreateIdentity(t.Context(), db.CreateIdentityParams{
				Provider: "strava", ProviderUserID: "completeness-" + row.name, UserID: user.ID,
				RefreshToken: row.token, RefreshTokenEnc: row.enc,
			}); err != nil {
				t.Fatalf("create identity: %v", err)
			}
			after, err := Observe(t.Context(), q)
			if err != nil {
				t.Fatalf("Observe: %v", err)
			}
			if got := after - before; got != row.adds {
				t.Errorf("an identity %s moved the count by %d — want %d", row.name, got, row.adds)
			}
		})
	}
}
