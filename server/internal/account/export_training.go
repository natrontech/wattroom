package account

import (
	"encoding/json"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The riding: every ride and where it was sent, the workouts the rider
// wrote, and what the rides earned them.

// rides is rides.json, from the rows handleExport read before anything else:
// the samples loop walks the same slice, so one read serves both, and a
// failure there sinks the export before this can run.
func (x *export) rides() category {
	return category{"rides.json", []string{"rides"}, func() (any, error) {
		// Every column the ride page shows (#1550): the export's scope is
		// what the rider can already see, and four of these were missing.
		summaries := make([]map[string]any, 0, len(x.rideRows))
		for _, ride := range x.rideRows {
			var normWatts any
			if ride.NormWatts != nil {
				normWatts = *ride.NormWatts
			}
			summaries = append(summaries, map[string]any{
				"workoutName":     ride.WorkoutName,
				"startedAt":       ride.StartedAt.Time,
				"seconds":         ride.Seconds,
				"avgWatts":        ride.AvgWatts,
				"normWatts":       normWatts,
				"kj":              ride.Kj,
				"execution":       ride.Execution,
				"executionScored": ride.ExecutionScored,
				"ftpWatts":        ride.FtpWatts,
				// The number a ramp test produced (ADR-0049, #2089): the ride
				// page shows it and the export did not, so the one ride that
				// moved the rider's FTP read like any other.
				"ftpAfterWatts": ride.FtpAfterWatts,
				"xp":            ride.Xp,
				// Where it was ridden (#2443): null for a solo ride.
				"crew":              ride.CrewName,
				"channel":           ride.ChannelName,
				"sharedWithFriends": ride.SharedAt.Valid,
				"curve":             json.RawMessage(ride.Curve),
				// What the rider said about the ride (#2328, ADR-0053): the only
				// two fields here they wrote themselves, and the two ADR-0055
				// keeps off every read that is not this one. null on the rides
				// nobody rated, which is most of them.
				"rpe":  ride.Rpe,
				"note": ride.Note,
				// How and where it was ridden (#3053): null on a ride from
				// before the columns, and the road ones on a ride with no road.
				// routeKey and roadHash are hashes of the rider's own road —
				// data held about them, so it goes, though it names no place.
				"rideMode":    ride.RideMode,
				"timeable":    ride.Timeable,
				"fromM":       ride.FromM,
				"distanceM":   ride.DistanceM,
				"climbedM":    ride.ClimbedM,
				"weightKg":    ride.WeightKg,
				"meanShelter": ride.MeanShelter,
				"routeKey":    ride.RouteKey,
				"roadHash":    ride.RoadH,
			})
		}
		return summaries, nil
	}}
}

func (x *export) workouts() category {
	return category{"workouts.json", []string{"workouts"}, func() (any, error) {
		rows, err := x.q.ExportUserWorkouts(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserWorkoutsRow) any {
			return map[string]any{"name": row.Name, "author": row.Author,
				"createdAt": row.CreatedAt.Time, "workout": json.RawMessage(row.Definition)}
		})
	}}
}

func (x *export) xp() category {
	return category{"xp.json", []string{"xp_events"}, func() (any, error) {
		rows, err := x.q.ExportUserXp(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserXpRow) any {
			return map[string]any{"amount": row.Amount, "source": row.Source,
				"about": row.Ref, "at": row.At.Time}
		})
	}}
}

func (x *export) trophies() category {
	return category{"trophies.json", []string{"achievements"}, func() (any, error) {
		rows, err := x.q.ExportUserAchievements(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserAchievementsRow) any {
			return map[string]any{"trophy": row.Key, "earnedAt": row.EarnedAt.Time}
		})
	}}
}

func (x *export) rideUploads() category {
	// No table of its own on the coverage walk: ride_deliveries hangs off
	// rides, not users, and goes with the ride.
	return x.bounded("ride-uploads.json", nil, func() (any, int, error) {
		// Where each ride was sent and whether it arrived (#2089, #799):
		// the ride page says "On Strava as …", or waiting, or failed, and
		// none of it was in the archive — so a rider whose upload had
		// been failing for a month exported no trace of it.
		//
		// The bookkeeping is ours: destination, state, attempts, the error
		// our uploader recorded and the two timestamps are all about a
		// ride WE recorded and sent. The remote activity number is the one
		// field Strava handed back, and Strava's own API Policy is what
		// permits it here — §2.3 and §5.4 allow their data to be shown to
		// that athlete, which is exactly and only what this route does.
		// AGENTS.md's firewall is about LLM and agent features; an
		// authenticated zip to the account's owner is neither.
		//
		// The ride is named by its start, the way medals.json names one,
		// so a row lines up with rides.json without a uuid having to mean
		// something outside this database.
		rows, err := x.q.ExportUserRideDeliveries(x.ctx, db.ExportUserRideDeliveriesParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		out, err := mapRows(rows, err, func(row db.ExportUserRideDeliveriesRow) any {
			return map[string]any{"destination": row.Destination, "state": row.State,
				"attempts": row.Attempts, "lastError": row.LastError,
				"remoteActivityId": row.RemoteID, "workoutName": row.WorkoutName,
				"rideStartedAt": row.RideStartedAt.Time,
				"firstTriedAt":  row.CreatedAt.Time, "lastMovedAt": row.UpdatedAt.Time}
		})
		return out, len(rows), err
	})
}

func (x *export) medals() category {
	return category{"medals.json", []string{"medals"}, func() (any, error) {
		// Shown on the ride and rider pages, purged with the account —
		// and never exported until #1550.
		rows, err := x.q.ExportUserMedals(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserMedalsRow) any {
			return map[string]any{"medal": row.Kind, "crew": row.CrewName,
				"rideStartedAt": row.RideStartedAt.Time, "awardedAt": row.AwardedAt.Time}
		})
	}}
}
