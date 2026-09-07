package secrets

import (
	"context"
	"log/slog"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Backfill seals the refresh tokens written before a key existed, once, at
// boot (#697). Without it the plaintext column keeps its value for every
// rider who has not reconnected or had a token rotated since — and the column
// cannot be dropped a release later while it still holds live credentials.
//
// Deliberately not fatal and deliberately not a transaction. It is a
// best-effort sweep over a table bounded by third-party connections rather
// than riders: a row it cannot seal is left exactly as it was and read through
// the plaintext path, and the next boot tries again. A server that refuses to
// start because one row would not update helps nobody.
func Backfill(ctx context.Context, st *store.Store, keys *Cipher, log *slog.Logger) {
	if st == nil || !keys.Enabled() {
		return
	}
	rows, err := st.Queries.ListPlaintextRefreshTokens(ctx)
	if err != nil {
		log.Error("token backfill: list", "err", err)
		return
	}
	sealed := 0
	for _, row := range rows {
		if row.RefreshToken == nil || *row.RefreshToken == "" {
			continue
		}
		box, err := keys.Seal(*row.RefreshToken)
		if err != nil {
			// No token in the message: this is the value being protected.
			log.Error("token backfill: seal", "provider", row.Provider, "err", err)
			continue
		}
		if err := st.Queries.SealRefreshToken(ctx, db.SealRefreshTokenParams{
			Provider: row.Provider, ProviderUserID: row.ProviderUserID, RefreshTokenEnc: box,
		}); err != nil {
			log.Error("token backfill: write", "provider", row.Provider, "err", err)
			continue
		}
		sealed++
	}
	if sealed > 0 {
		log.Info("sealed stored refresh tokens", "count", sealed)
	}
}
