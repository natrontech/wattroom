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
			scored, ok := normFromBlob(row.Samples)
			if !ok {
				// The blob will not decode. Storing 0 took the row out of the
				// queue and put it beyond every reader's reach: the fallback
				// written for exactly this row is `coalesce(norm_watts,
				// avg_watts)` and `normWatts != nil`, and a stored 0 walks
				// past both — the ride then reads 0 W NormPower on its own
				// page and adds 0 to that day's Load, forever (#2253). Store
				// what the coalesce would have chosen, and say which ride.
				scored = int(row.AvgWatts)
				log.Warn("norm backfill: unreadable samples, stored the average",
					"ride", store.UUIDString(row.ID), "avgWatts", row.AvgWatts)
			}
			norm := int16(scored) //nolint:gosec // samples bounded 0-3000
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

// normFromBlob scores one stored sample blob. false means the blob would not
// decode — the caller decides what to store, because 0 is a real NormPower
// and cannot also mean "unreadable" (#2253).
func normFromBlob(blob []byte) (int, bool) {
	samples, err := DecodeSamples(blob)
	if err != nil {
		return 0, false
	}
	watts := make([]int, len(samples))
	for i, sample := range samples {
		watts[i] = sample.Watts
	}
	return NormPower(watts), true
}
