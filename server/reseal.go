package main

import (
	"context"
	"errors"
	"log/slog"
	"os"

	"github.com/natrontech/wattroom/server/internal/routes"
	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/store"
)

// previousKeyEnv holds the key a rotation replaced, for `wattroom
// reseal-routes` only — the server itself never reads it.
const previousKeyEnv = "WATTROOM_TOKEN_KEY_PREVIOUS"

// resealRoutes is `wattroom reseal-routes` (#3024, ADR-0063; deploy/README.md
// has the rotation): with WATTROOM_TOKEN_KEY already the new key and
// WATTROOM_TOKEN_KEY_PREVIOUS the old one, it opens every route sealed under
// the old key and seals it under the new. Stored Strava tokens are not
// touched — a rotation still means reconnecting those (ADR-0035).
func resealRoutes(ctx context.Context, log *slog.Logger) error {
	dsn := os.Getenv("WATTROOM_DB")
	if dsn == "" {
		return errors.New("WATTROOM_DB is unset")
	}
	next, err := secrets.FromEnv(log)
	if err != nil {
		return err
	}
	if !next.Enabled() {
		return errors.New(secrets.KeyEnv + " is unset — set it to the new key")
	}
	raw := os.Getenv(previousKeyEnv)
	if raw == "" {
		return errors.New(previousKeyEnv + " is unset — set it to the key being replaced")
	}
	prev, err := secrets.FromKey(previousKeyEnv, raw)
	if err != nil {
		return err
	}
	st, err := store.Open(ctx, dsn)
	if err != nil {
		return err
	}
	defer st.Close()
	moved, err := routes.Reseal(ctx, st.Queries, prev, next)
	log.Info("routes re-sealed", "routes", moved, "fromVersion", prev.Version(), "toVersion", next.Version())
	return err
}
