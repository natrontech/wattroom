// Package storetest opens the test database for every package that needs one,
// so the rule below lives in one place instead of twenty-one.
package storetest

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
)

// mainTreeDSN is the fallback: the main working tree's test database, which is
// what a bare `go test` gets and is therefore still shared between checkouts.
const mainTreeDSN = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials

// DSN names the test database this process must use — NEVER a dev database,
// these tests delete users. WATTROOM_TEST_DB when the caller set one: `make
// test` names this checkout's own (scripts/dev-env.sh, so two worktrees
// testing at once no longer delete each other's rows) and CI its service
// container's.
func DSN() string {
	if dsn := os.Getenv("WATTROOM_TEST_DB"); dsn != "" {
		return dsn
	}
	return mainTreeDSN
}

// Open connects to DSN and migrates it.
//
// No database at all is a skip: a laptop without make infra. Everything else
// is a FAILURE: a test that skips on "migrate: ..." reads as green while
// running nothing, which is how a whole suite passed for most of a day
// (2026-09-09). The refusal that day was a missing migration, which the
// server now applies instead (#1481); the rule outlives its example — and it
// covers a dsn that will not parse too, which used to land in the skip and so
// made a typo in WATTROOM_TEST_DB print ok for seventeen packages (#2352).
func Open(t testing.TB) *store.Store {
	t.Helper()
	dsn := DSN()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		if errors.Is(err, store.ErrUnreachable) {
			t.Skipf("no database available: %v", err)
		}
		t.Fatalf("the test database is unusable, and this is not the absence a skip is for: either WATTROOM_TEST_DB is not a dsn (it takes a connection string, not a database name — #2352), or the database answered and refused a migration it will not take, which is not the same as one it merely has not seen (#1481): %v", err)
	}
	t.Cleanup(st.Close)
	return st
}
