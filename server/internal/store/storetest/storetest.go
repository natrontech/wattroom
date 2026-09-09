// Package storetest opens the shared test database for every package that
// needs one, so the rule below lives in one place instead of twenty-one.
package storetest

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
)

// Open connects and migrates the test database named by WATTROOM_TEST_DB
// (make test's wattroom_test by default — NEVER the dev database, tests
// delete users). No database at all is a skip: a laptop without make infra.
// A database that answers and then refuses is a FAILURE: a test that skips
// on "migrate: missing migration" reads as green while running nothing,
// which is how a whole suite passed for most of a day (2026-09-09).
func Open(t testing.TB) *store.Store {
	t.Helper()
	dsn := os.Getenv("WATTROOM_TEST_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials
	}
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
