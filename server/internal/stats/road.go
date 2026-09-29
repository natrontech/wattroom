package stats

import (
	"context"
	"math"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// What a ride keeps about how and where it was ridden (#3053): facts that
// exist only at the moment it is saved.

// RoadRide is a ride's place on a stored road, as the server works it out.
type RoadRide struct {
	// Metres along the road where the ride started, how far it went, and
	// what it climbed over those metres.
	FromM, DistanceM, ClimbedM float64
	// How far the client's own metres part from DistanceM, as a fraction of
	// it: the replay is the record, and a gap this wide is worth a log line.
	Gap float64
}

// ReplayGapLogged is the gap between the client's metres and the replay
// above which the save logs it (#3053).
const ReplayGapLogged = 0.01

// ReplayRoad rides the samples' watts along the road again, a second a
// sample, from where the first sample stood, with the one pace model (#3048).
// The server's replay is the only clock (ADR-0074): the distance a road ride
// keeps is this one, never the metres the client sent.
func ReplayRoad(r road.Road, samples []protocol.RiderMetrics, massKg float64) RoadRide {
	from := min(max(samples[0].M, 0), r.LengthM)
	p := road.Pace{}
	for _, s := range samples {
		at := from + p.Distance
		if at >= r.LengthM {
			break
		}
		p.Step(float64(s.Watts), r.GradeAt(at), massKg, protocol.PaceDefaultCdA, 0)
	}
	distance := min(p.Distance, r.LengthM-from)
	out := RoadRide{FromM: from, DistanceM: distance, ClimbedM: r.ClimbedBetween(from, from+distance)}
	if reported := samples[len(samples)-1].M - samples[0].M; distance > 0 {
		out.Gap = math.Abs(reported-distance) / distance
	}
	return out
}

// RideMode is ADR-0062's word for how a ride was ridden. An empty workout
// marked unscored is a free ride on a rider's own and a game in a session —
// both save that way — and anything else is a workout. Bunch and race arrive
// with the sessions that ride a road.
func RideMode(workoutJSON string, inSession bool) string {
	segments, _ := workout.Parse(workoutJSON)
	if len(segments) > 0 || !workout.Unscored(workoutJSON) {
		return "workout"
	}
	if inSession {
		return "game"
	}
	return "free"
}

// How a trainer was driven along a road (#3516, ADR-0074, ADR-0084): by the
// road's grade in SIM, the same through gears, or "Don't make me shift" —
// ERG by the road, where WattRoom chose the watts. A save names one on a
// road ride; the client's own words (ride-grade.ts's ergByRoad).
const (
	DriveSIM       = "sim"
	DriveGears     = "gears"
	DriveERGByRoad = "ergByRoad"
)

// KnownDrive says whether a save's drive is one of those, or unsaid.
func KnownDrive(drive string) bool {
	switch drive {
	case "", DriveSIM, DriveGears, DriveERGByRoad:
		return true
	}
	return false
}

// Timeable is ADR-0074's table, written at save: a time is the rider's when
// their own watts moved their dot along a road. A ride with no road has no
// time to keep, and a workout on a road measures the workout — unless it is
// road steps alone, which are timed like a free ride on the road. Either is
// timed when the grade drove the trainer, in SIM or through gears, and it
// was not ridden mostly in someone's shelter; "Don't make me shift" never
// is. A road ride that does not say how it was driven is nil — not known,
// never a guess, since the column cannot be backfilled.
func Timeable(mode, workoutJSON string, onRoad bool, drive string, meanShelter float64) *bool {
	no, yes := false, true
	if !onRoad {
		return &no
	}
	switch mode {
	case "free":
	case "workout":
		if !roadStepsAlone(workoutJSON) {
			return &no
		}
	default: // a session's game; bunch and race arrive with the sessions that ride a road
		return &no
	}
	switch drive {
	case DriveSIM, DriveGears:
		if meanShelter > protocol.MaxTimeableShelter {
			return &no
		}
		return &yes
	case DriveERGByRoad:
		return &no
	}
	return nil
}

// roadStepsAlone says whether every block of a workout is a road step — the
// road setting the grade, never a target — ADR-0074's "solo road step".
func roadStepsAlone(workoutJSON string) bool {
	segments, err := workout.Parse(workoutJSON)
	if err != nil || len(segments) == 0 {
		return false
	}
	for _, s := range segments {
		if s.Kind != "road" {
			return false
		}
	}
	return true
}

// WeightThatDay is the weight a ride keeps (ADR-0048): the rider's, when
// they set it themselves. A default weight is nobody's, and nil says so.
func WeightThatDay(u db.User) *int16 {
	if u.WeightSource == nil || *u.WeightSource == "default" {
		return nil
	}
	w := u.WeightKg
	return &w
}

// accountWeight is a session rider's weight that day, read off their
// account. A rider the read cannot find keeps the ride without one rather
// than losing it.
func accountWeight(ctx context.Context, q *db.Queries, user pgtype.UUID) *int16 {
	u, err := q.GetUser(ctx, user)
	if err != nil {
		return nil
	}
	return WeightThatDay(u)
}

// SetHow writes how every ride was ridden onto its row: its mode, whether a
// time on it is the rider's, and their weight that day. Mean shelter reads 0
// until the hub computes shelter (ADR-0077).
func SetHow(row *db.CreateRideParams, mode, workoutJSON string, onRoad bool, drive string, weight *int16) {
	row.RideMode, row.WeightKg = &mode, weight
	row.Timeable = Timeable(mode, workoutJSON, onRoad, drive, 0)
}

// SetRoad writes a road ride's summary onto its row: the route, the road's
// hash as both its key and the served road's name (the two part with #3241),
// and where on it the ride went.
func SetRoad(row *db.CreateRideParams, route db.GetOwnerRouteRow, ride RoadRide) {
	key := route.RoadHash
	row.RouteID = route.ID
	row.RouteKey, row.RoadH = &key, &key
	row.FromM = metres(ride.FromM)
	row.DistanceM = metres(ride.DistanceM)
	row.ClimbedM = metres(ride.ClimbedM)
}

func metres(m float64) *int32 {
	v := int32(math.Round(m)) //nolint:gosec // bounded by MaxRouteMeters
	return &v
}
