package usage

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/metrics"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

// A count that is right and a gauge nobody serves read the same on a
// dashboard: flat. #2321 was exactly that, so this asserts the SERVED page.
func TestTheCountsReachTheServedMetricsPage(t *testing.T) {
	st := storetest.Open(t)

	n, err := Observe(t.Context(), st.Queries)
	if err != nil {
		t.Fatalf("Observe: %v", err)
	}

	rec := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/metrics", nil))
	page := rec.Body.String()
	for _, want := range []string{
		fmt.Sprintf("wattroom_accounts %d\n", n.Accounts),
		fmt.Sprintf("wattroom_rides %d\n", n.Rides),
		fmt.Sprintf(`wattroom_accounts_created{window="7d"} %d`+"\n", n.Accounts7d),
		fmt.Sprintf(`wattroom_riders_active{window="30d"} %d`+"\n", n.Riders30d),
	} {
		if !strings.Contains(page, want) {
			t.Errorf("the metrics page does not carry %q", want)
		}
	}
}

// What each count means, as the delta a known set of rows makes. Inside one
// REPEATABLE READ transaction, rolled back: the counts are global and
// `go test ./...` runs packages in parallel against one database, so a delta
// taken on the pool would be other packages' fixtures as much as these.
func TestEachCountIsWhatItsNameSays(t *testing.T) {
	st := storetest.Open(t)
	tx, err := st.Pool.BeginTx(t.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(t.Context()) }()
	q := db.New(tx)
	ctx := t.Context()

	before, err := q.CountUsage(ctx)
	if err != nil {
		t.Fatalf("CountUsage: %v", err)
	}

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	account := func(age string) pgtype.UUID {
		t.Helper()
		var id pgtype.UUID
		if err := tx.QueryRow(ctx, `insert into users (display_name, created_at) values ('Usage', now() - $1::interval) returning id`, age).Scan(&id); err != nil {
			t.Fatalf("user: %v", err)
		}
		return id
	}
	ride := func(user pgtype.UUID, age string, seconds, kj int) {
		t.Helper()
		exec(`insert into rides (user_id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, samples)
		      values ($1, 'Usage', now() - $2::interval, $3, 200, $4, 1, 250, '\x00')`, user, age, seconds, kj)
	}

	today, lastWeek, lastMonth, gone := account("1 hour"), account("3 days"), account("20 days"), account("40 days")

	ride(today, "1 hour", 3600, 700)
	ride(lastWeek, "3 days", 1800, 300)
	// Two rides, one rider: the active count is accounts, not rides.
	ride(lastMonth, "20 days", 600, 100)
	ride(lastMonth, "21 days", 600, 100)
	// Rode once, long ago: a ride, not an active rider.
	ride(gone, "40 days", 60, 10)

	code := "usage-" + t.Name()
	crew, err := q.CreateCrew(ctx, db.CreateCrewParams{Name: "Usage", OwnerID: today, Code: &code})
	if err != nil {
		t.Fatalf("CreateCrew: %v", err)
	}
	session := func(in string) {
		t.Helper()
		exec(`insert into scheduled_sessions (crew_id, workout_name, workout_json, starts_at, created_by)
		      values ($1, 'Usage', '{}', now() + $2::interval, $3)`, crew.ID, in, today)
	}
	session("1 day")
	session("-1 day")

	exec(`insert into workouts (owner_id, name, definition) values ($1, 'Mine', '{}'), (null, 'Built in', '{}')`, today)
	exec(`insert into identities (provider, provider_user_id, user_id) values ('strava', 'usage-1', $1), ('google', 'usage-2', $1)`, today)

	after, err := q.CountUsage(ctx)
	if err != nil {
		t.Fatalf("CountUsage: %v", err)
	}

	for _, c := range []struct {
		name          string
		before, after int64
		adds          int64
	}{
		{"accounts", before.Accounts, after.Accounts, 4},
		{"accounts 1d", before.Accounts1d, after.Accounts1d, 1},
		{"accounts 7d", before.Accounts7d, after.Accounts7d, 2},
		{"accounts 30d", before.Accounts30d, after.Accounts30d, 3},
		{"riders 1d", before.Riders1d, after.Riders1d, 1},
		{"riders 7d", before.Riders7d, after.Riders7d, 2},
		{"riders 30d", before.Riders30d, after.Riders30d, 3},
		{"rides", before.Rides, after.Rides, 5},
		{"ridden seconds", before.RiddenSeconds, after.RiddenSeconds, 6660},
		{"ridden kJ", before.RiddenKj, after.RiddenKj, 1210},
		{"crews", before.Crews, after.Crews, 1},
		{"workouts, the built-in one not counted", before.Workouts, after.Workouts, 1},
		{"strava connections, not other sign-ins", before.StravaConnections, after.StravaConnections, 1},
		{"sessions upcoming, not past", before.SessionsUpcoming, after.SessionsUpcoming, 1},
	} {
		if got := c.after - c.before; got != c.adds {
			t.Errorf("%s: the fixture added %d, want %d", c.name, got, c.adds)
		}
	}
}
