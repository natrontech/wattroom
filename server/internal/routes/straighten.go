package routes

import (
	"context"
	"encoding/base64"
	"errors"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// turnsRule is the rule a road's turns are built by, as routes.turns_v
// counts it: 1 is #4379's carried rounding over the line's own heading
// (#4383). A road imported before it drew a long route drifting onto itself
// and its hairpins wide.
const turnsRule = 1

// storeEvery is $lib/road/route's STORE_EVERY: a stored sample, and a turn,
// every second sample of the line.
const storeEvery = 2

// StraightenRoads rebuilds, at boot and in pages, the turns of every road
// whose turns predate turnsRule, from the route's own line (#4383): the
// shape sealed beside it is the import's smoothed line, sample for sample.
// Only the sealed whole road changes. Its heights, the bare road (which
// keeps no turns) and road_hash, which ghosts and times match on, stay as
// they were, so no time moves; only the world draws the road straighter.
// A road it cannot rebuild is marked as it is, so no boot reads it again.
func StraightenRoads(ctx context.Context, q *db.Queries, keys *secrets.Cipher, log *slog.Logger) {
	if !keys.Enabled() {
		return // a keyless server keeps no line to rebuild from
	}
	version := keys.Version()
	var after pgtype.UUID
	after.Valid = true
	straightened, kept := 0, 0
	for {
		rows, err := q.ListRoutesToStraighten(ctx, db.ListRoutesToStraightenParams{KeyVersion: &version, TurnsV: turnsRule, After: after, Lim: 100})
		if err != nil {
			log.Error("route turns: list failed", "err", err)
			return
		}
		if len(rows) == 0 {
			break
		}
		for _, row := range rows {
			after = row.ID
			id := store.UUIDString(row.ID)
			sealed, err := rebuilt(keys, row)
			ok := err == nil
			if !ok {
				log.Warn("route turns: kept as imported", "route", id, "err", err)
				sealed = row.RoadSealed
			}
			n, err := q.StraightenRoute(ctx, db.StraightenRouteParams{ID: row.ID, RoadSealed: sealed, TurnsV: turnsRule, KeyVersion: &version})
			if err != nil {
				log.Error("route turns: write failed", "route", id, "err", err)
				return
			}
			if ok {
				straightened += int(n)
			} else {
				kept += int(n)
			}
		}
	}
	if straightened+kept > 0 {
		log.Info("route turns rebuilt", "straightened", straightened, "kept", kept)
	}
}

// errShapeOffRoad is a line that is not the road's: another number of samples.
var errShapeOffRoad = errors.New("routes: the sealed line does not match the road's samples")

// rebuilt is a row's whole road with its turns rebuilt from its line,
// sealed again; an error leaves the row's road as it is.
func rebuilt(keys *secrets.Cipher, row db.ListRoutesToStraightenRow) ([]byte, error) {
	shape, err := keys.Open(row.GeomSealed)
	if err != nil {
		return nil, err
	}
	text, err := keys.Open(row.RoadSealed)
	if err != nil {
		return nil, err
	}
	packed, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		return nil, err
	}
	rd, err := road.UnpackRoad(packed)
	if err != nil {
		return nil, err
	}
	points, err := road.DecodePolyline6(shape, maxPlacePoints)
	if err != nil {
		return nil, err
	}
	turns := road.TurnsOfShape(points, storeEvery)
	if len(turns) != len(rd.Turns) {
		return nil, errShapeOffRoad
	}
	rd.Turns = turns
	return sealRoad(keys, rd.Pack())
}
