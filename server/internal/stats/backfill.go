package stats

import (
	"context"
	"log/slog"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// BackfillNormWatts fills norm_watts on rides saved before ADR-0016, reading
// each blob exactly once. Idempotent (null-guarded), so running it on every
// start is free once done. Exits when no rows remain, an error repeats, or
// ctx ends. ponytail: serial batches of 100 — at alpha ride counts this is
// seconds of work; parallelize only if a big import ever makes it minutes.
func BackfillNormWatts(ctx context.Context, st *store.Store, log *slog.Logger) {
	filled := 0
	for {
		rows, err := st.Queries.ListRidesMissingNorm(ctx, 100)
		if err != nil {
			log.Error("norm backfill list failed", "err", err)
			return
		}
		if len(rows) == 0 {
			if filled > 0 {
				log.Info("norm backfill done", "rides", filled)
			}
			return
		}
		for _, row := range rows {
			norm := int16(normFromBlob(row.Samples)) //nolint:gosec // samples bounded 0-3000
			err := st.Queries.SetRideNormWatts(ctx, db.SetRideNormWattsParams{
				ID: row.ID, NormWatts: &norm,
			})
			if err != nil {
				log.Error("norm backfill update failed", "err", err)
				return
			}
			filled++
		}
	}
}

// normFromBlob scores one stored sample blob. An unreadable blob yields 0 —
// stored, so the row leaves the backfill queue instead of erroring forever.
func normFromBlob(blob []byte) int {
	samples, err := DecodeSamples(blob)
	if err != nil {
		return 0
	}
	watts := make([]int, len(samples))
	for i, sample := range samples {
		watts[i] = sample.Watts
	}
	return NormPower(watts)
}
