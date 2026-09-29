package wallet

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// steady is `seconds` of riding at `watts`.
func steady(seconds, watts int) []int {
	out := make([]int, seconds)
	for i := range out {
		out[i] = watts
	}
	return out
}

// docs/SPEC.md "Wardrobe": one Batzen a minute at your own FTP, at most 1.2 ×
// the minutes pedalled, zero-watt seconds earning nothing, × 1.2 in a group.
func TestBatzen(t *testing.T) {
	tests := []struct {
		name  string
		watts []int
		ftp   int
		group bool
		want  int32
	}{
		{"an hour at FTP", steady(3600, 250), 250, false, 60},
		{"an hour at half FTP", steady(3600, 125), 250, false, 30},
		{"a lighter rider's hour at their own FTP", steady(3600, 180), 180, false, 60},
		{"half an hour at twice FTP: held to 1.2 × the minutes", steady(1800, 500), 250, false, 36},
		{"zero-watt seconds earn nothing, nor count as minutes", append(steady(1800, 500), steady(1800, 0)...), 250, false, 36},
		{"an hour at FTP in a group session", steady(3600, 250), 250, true, 72},
		{"a minute short of a Batzen", steady(59, 250), 250, false, 0},
		{"no FTP", steady(3600, 250), 0, false, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Batzen(tt.watts, tt.ftp, tt.group); got != tt.want {
				t.Fatalf("Batzen = %d, want %d", got, tt.want)
			}
		})
	}
}

type harness struct {
	st    *store.Store
	users *testx.Users
	mux   *http.ServeMux
}

func setup(t *testing.T) *harness {
	t.Helper()
	st := storetest.Open(t)
	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 250, WeightKg: 70})
		if err != nil {
			t.Fatal(err)
		}
		users.ByToken[name] = u
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
	}
	mux := http.NewServeMux()
	New(st, users, slog.New(slog.DiscardHandler)).Register(mux)
	return &harness{st: st, users: users, mux: mux}
}

func (h *harness) id(name string) pgtype.UUID { return h.users.ByToken[name].ID }

func (h *harness) balance(t *testing.T, name string) int64 {
	t.Helper()
	n, err := h.st.Queries.WalletBalance(t.Context(), h.id(name))
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// ride stores a ride the way a save before the wallet did: no mint.
func (h *harness) ride(t *testing.T, name string, kj, seconds int32, ago time.Duration) pgtype.UUID {
	t.Helper()
	id, err := h.st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: h.id(name), WorkoutName: "Before the wallet",
		StartedAt: pgtype.Timestamptz{Time: time.Now().Add(-ago).Truncate(time.Second), Valid: true},
		Seconds:   seconds, AvgWatts: 200, Kj: kj, Execution: 0.9, FtpWatts: 250,
		Samples: []byte("x"), Curve: []byte(`{}`), Xp: kj,
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// mintLocked is a save's own mint: in a transaction, under the rider's lock.
func (h *harness) mintLocked(t *testing.T, name string, ride pgtype.UUID, amount int32) {
	t.Helper()
	tx, err := h.st.Pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(t.Context()) }()
	q := h.st.Queries.WithTx(tx)
	if err := q.LockUser(t.Context(), h.id(name)); err != nil {
		t.Fatal(err)
	}
	if err := MintRide(t.Context(), q, h.id(name), ride, amount); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
}

// At most 180 per UTC day of the save, however many rides make it (#3152).
// The welcome's 100 is a grant and outside it; a retried save of the same
// ride writes nothing twice.
func TestMintingHoldsTheDaysCap(t *testing.T) {
	h := setup(t)
	first, second := h.ride(t, "alice", 1800, 7200, time.Hour), h.ride(t, "alice", 1800, 7200, 3*time.Hour)
	h.mintLocked(t, "alice", first, 120)
	h.mintLocked(t, "alice", first, 120) // the retry
	if got := h.balance(t, "alice"); got != welcome+120 {
		t.Fatalf("balance %d after one ride, want %d", got, welcome+120)
	}
	h.mintLocked(t, "alice", second, 120)
	if got := h.balance(t, "alice"); got != welcome+dayCap {
		t.Fatalf("balance %d after two rides, want the welcome and the day's cap, %d", got, welcome+dayCap)
	}
	if got := h.balance(t, "bob"); got != 0 {
		t.Fatalf("bob has %d Batzen from alice's riding", got)
	}
}

// Existing riders get one opening grant from the riding they did before the
// wallet, capped (ADR-0069); a second run grants nothing, a ride the wallet
// already paid counts nothing, and the synthetic account gets none.
func TestTheOpeningGrantIsCappedAndOnce(t *testing.T) {
	h := setup(t)
	h.ride(t, "alice", 900, 3600, time.Hour) // an hour at 250 W: 60
	paid := h.ride(t, "alice", 900, 3600, 2*time.Hour)
	h.mintLocked(t, "alice", paid, 60)
	for i := range 30 { // 30 hours at FTP: 1,800, over the cap
		h.ride(t, "bob", 900, 3600, time.Duration(i+1)*time.Hour)
	}
	synthetic, err := h.st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: "monitor", FtpWatts: 250, WeightKg: 70})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = h.st.Pool.Exec(context.Background(), "delete from users where id = $1", synthetic.ID) })
	if _, err := h.st.Pool.Exec(t.Context(),
		"insert into identities (user_id, provider, provider_user_id) values ($1, 'synthetic', $2)",
		synthetic.ID, store.UUIDString(synthetic.ID)); err != nil {
		t.Fatal(err)
	}

	for range 2 {
		Open(t.Context(), h.st, slog.New(slog.DiscardHandler))
	}
	opening := func(user pgtype.UUID) (n int, amount int32) {
		t.Helper()
		if err := h.st.Pool.QueryRow(t.Context(),
			"select count(*), coalesce(sum(amount), 0) from wallet_events where user_id = $1 and source = 'opening'",
			user).Scan(&n, &amount); err != nil {
			t.Fatal(err)
		}
		return n, amount
	}
	if n, amount := opening(h.id("alice")); n != 1 || amount != 60 {
		t.Errorf("alice's opening: %d rows of %d, want one of 60 — the paid ride counted, or the grant ran twice", n, amount)
	}
	if n, amount := opening(h.id("bob")); n != 1 || amount != openingCap {
		t.Errorf("bob's opening: %d rows of %d, want one of the cap %d", n, amount, openingCap)
	}
	if n, _ := opening(synthetic.ID); n != 0 {
		t.Errorf("the synthetic account got an opening grant")
	}

	// And it earns nothing by riding either.
	ride, err := h.st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: synthetic.ID, WorkoutName: "Monitor",
		StartedAt: pgtype.Timestamptz{Time: time.Now().Truncate(time.Second), Valid: true},
		Seconds:   3600, AvgWatts: 250, Kj: 900, FtpWatts: 250, Samples: []byte("x"), Curve: []byte(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := MintRide(t.Context(), h.st.Queries, synthetic.ID, ride, 60); err != nil {
		t.Fatal(err)
	}
	if n, err := h.st.Queries.WalletBalance(t.Context(), synthetic.ID); err != nil || n != 0 {
		t.Errorf("the synthetic account holds %d Batzen (%v)", n, err)
	}
}

func TestTheBalanceIsPrivateAndStartsWithTheWelcome(t *testing.T) {
	h := setup(t)
	get := func(user string) (int, map[string]any) {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me/wallet", nil)
		if user != "" {
			req.Header.Set("X-Test-User", user)
		}
		w := httptest.NewRecorder()
		h.mux.ServeHTTP(w, req)
		var body map[string]any
		_ = json.NewDecoder(w.Body).Decode(&body)
		return w.Code, body
	}
	if status, _ := get(""); status != http.StatusUnauthorized {
		t.Fatalf("signed out: %d, want 401", status)
	}
	for range 2 { // the welcome is granted once, however often it is read
		if status, body := get("alice"); status != http.StatusOK || body["balance"] != float64(welcome) {
			t.Fatalf("alice's balance: %d %v, want %d", status, body, welcome)
		}
	}
}
