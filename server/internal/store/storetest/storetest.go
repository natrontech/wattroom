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
// No database at all is a skip: a laptop without make infra. A database that
// answers and then refuses is a FAILURE: a test that skips on "migrate:
// missing migration" reads as green while running nothing, which is how a
// whole suite passed for most of a day (2026-09-09).
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
		t.Fatalf("the test database answered but is unusable — is it ahead of this branch's migrations? drop and recreate it: %v", err)
	}
	t.Cleanup(st.Close)
	return st
}
