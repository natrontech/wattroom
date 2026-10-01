package routes

import (
	"bytes"
	"context"
	"encoding/base64"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A route's road is kept twice (#3511, ADR-0063): whole and sealed in
// road_sealed, for its owner and for the crew cut, and bare in road — what a
// dump or a keyless server may hold. Turns add back up to the shape and
// absolute heights pin it on an elevation map, so bare keeps neither.

// bare is the road with heights above its first sample and no turns: still
// a road every reader can ride, one that draws no shape and has no altitude.
func bare(rd road.Road) []byte {
	out := road.Road{LengthM: rd.LengthM, Heights: make([]float64, len(rd.Heights)), Turns: make([]int8, len(rd.Turns))}
	for i, h := range rd.Heights {
		out.Heights[i] = h - rd.Heights[0]
	}
	return out.Pack()
}

// sealRoad seals the whole packed road under the key the shape is sealed
// with, as base64 text — what the cipher seals.
func sealRoad(keys *secrets.Cipher, packed []byte) ([]byte, error) {
	return keys.Seal(base64.StdEncoding.EncodeToString(packed))
}

// WholeRoad is the road as its owner posted it: opened from its seal, or the
// stored road where nothing was sealed — a keyless server keeps no more, and
// a row from before #3511 still holds the whole road until the boot seals it.
// A seal that will not open is an error; the stored road is the caller's to
// fall back on.
func WholeRoad(keys *secrets.Cipher, stored, sealed []byte, version *int32) ([]byte, error) {
	if sealed == nil {
		return stored, nil
	}
	text, err := Open(keys, sealed, version)
	if err != nil {
		return nil, err
	}
	return base64.StdEncoding.DecodeString(text)
}

// SealRoads seals and strips every road stored before #3511, at boot and in
// pages: under the server's key the whole road goes to road_sealed, and road
// keeps the bare one; with no key, road is stripped alone. A row sealed
// under a key this server does not hold is left for the re-seal — its road
// is never stripped on a guess, since stripping cannot be undone.
func SealRoads(ctx context.Context, q *db.Queries, keys *secrets.Cipher, log *slog.Logger) {
	var after pgtype.UUID
	after.Valid = true
	sealed, stripped := 0, 0
	for {
		rows, err := q.ListRoutesWithRoadInTheClear(ctx, db.ListRoutesWithRoadInTheClearParams{After: after, Lim: 100})
		if err != nil {
			log.Error("route roads: list failed", "err", err)
			return
		}
		if len(rows) == 0 {
			break
		}
		for _, row := range rows {
			after = row.ID
			ours := keys.Enabled() && row.KeyVersion != nil && *row.KeyVersion == keys.Version()
			if row.KeyVersion != nil && !ours {
				log.Warn("route roads: a road sealed under another key stays for the re-seal", "route", store.UUIDString(row.ID))
				continue
			}
			rd, err := road.UnpackRoad(row.Road)
			if err != nil {
				log.Error("route roads: stored road unreadable", "route", store.UUIDString(row.ID), "err", err)
				continue
			}
			kept := bare(rd)
			var seal []byte
			if ours {
				if seal, err = sealRoad(keys, row.Road); err != nil {
					log.Error("route roads: seal failed", "route", store.UUIDString(row.ID), "err", err)
					return
				}
			} else if bytes.Equal(kept, row.Road) {
				continue // a keyless row this ran over before
			}
			n, err := q.SealRouteRoad(ctx, db.SealRouteRoadParams{ID: row.ID, Road: kept, RoadSealed: seal, KeyVersion: row.KeyVersion})
			if err != nil {
				log.Error("route roads: write failed", "route", store.UUIDString(row.ID), "err", err)
				return
			}
			if seal != nil {
				sealed += int(n)
			} else {
				stripped += int(n)
			}
		}
	}
	if sealed+stripped > 0 {
		log.Info("route roads sealed", "sealed", sealed, "stripped", stripped)
	}
}
