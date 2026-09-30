package routes

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A route's attempts and your ghost (#3033, ADR-0068): every ride of the road
// you have saved, how it was ridden, your best time up each climb, and the
// ride you race — yours, and only ever yours. Owner-only: a road's history
// is its rider's.

const (
	// #3033: the ghost is your best in this long, else your last time.
	ghostWindow = 90 * 24 * time.Hour
	// #3033: a ride from an older snapshot of the road rides as a ghost only
	// when its metres agree with the road's length within this share.
	ghostLengthTolerance = 0.01
)

type attemptJSON struct {
	RideID    string    `json:"rideId"`
	StartedAt time.Time `json:"startedAt"`
	Seconds   int32     `json:"seconds"`
	DistanceM *int32    `json:"distanceM,omitempty"`
	ClimbedM  *int32    `json:"climbedM,omitempty"`
	FromM     *int32    `json:"fromM,omitempty"`
	// "timed" is ADR-0074's timeable ride, drawn solid; "together" a
	// session, bunch or race, and "erg" a ride the trainer held — both drawn
	// hollow.
	Kind string `json:"kind"`
}

type climbBestJSON struct {
	StartM  float64 `json:"startM"`
	TopM    float64 `json:"topM"`
	Cls     string  `json:"cls"`
	Seconds int     `json:"seconds"`
	RideID  string  `json:"rideId"`
}

func kindOf(a db.ListRouteAttemptsRow) string {
	switch {
	case a.Timeable != nil && *a.Timeable:
		return "timed"
	case a.Together || a.RideMode != nil && (*a.RideMode == "bunch" || *a.RideMode == "race"):
		return "together"
	default:
		return "erg"
	}
}

// ownRoute answers the route when it is the caller's — 403 when it is
// someone else's, as #3033 asks, 404 when there is none.
func (s *Service) ownRoute(w http.ResponseWriter, r *http.Request) (db.User, pgtype.UUID, db.GetRouteRoadRow, bool) {
	user, id, ok := s.owned(w, r)
	if !ok {
		return db.User{}, id, db.GetRouteRoadRow{}, false
	}
	row, err := s.store.Queries.GetRouteRoad(r.Context(), id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		notFound(w)
		return db.User{}, id, db.GetRouteRoadRow{}, false
	case err != nil:
		httpx.Fail(w, s.log, "route attempts read failed", err, "That route's rides could not be loaded.")
		return db.User{}, id, db.GetRouteRoadRow{}, false
	case row.OwnerID != user.ID:
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "A route's rides are its owner's to see.")
		return db.User{}, id, db.GetRouteRoadRow{}, false
	}
	return user, id, row, true
}

func (s *Service) handleAttempts(w http.ResponseWriter, r *http.Request) {
	user, id, route, ok := s.ownRoute(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListRouteAttempts(r.Context(), db.ListRouteAttemptsParams{UserID: user.ID, RouteKey: &route.RoadHash})
	if err != nil {
		httpx.Fail(w, s.log, "list route attempts failed", err, "That route's rides could not be loaded.")
		return
	}
	attempts := make([]attemptJSON, 0, len(rows))
	for _, a := range rows {
		attempts = append(attempts, attemptJSON{
			RideID: store.UUIDString(a.ID), StartedAt: a.StartedAt.Time, Seconds: a.Seconds,
			DistanceM: a.DistanceM, ClimbedM: a.ClimbedM, FromM: a.FromM, Kind: kindOf(a),
		})
	}
	bests, err := s.climbBests(r, user, id, route.RoadHash)
	if err != nil {
		httpx.Fail(w, s.log, "route climb bests failed", err, "That route's rides could not be loaded.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"attempts": attempts, "climbBests": bests})
}

// climbBests is the rider's fastest time up each classed climb of the road,
// from their timeable rides of it — a ride the trainer held or a bunch towed
// timed nothing (ADR-0074).
func (s *Service) climbBests(r *http.Request, user db.User, id pgtype.UUID, key string) ([]climbBestJSON, error) {
	owned, err := s.store.Queries.GetOwnerRoute(r.Context(), db.GetOwnerRouteParams{ID: id, OwnerID: user.ID})
	if err != nil {
		return nil, err
	}
	var climbs []climbJSON
	if err := json.Unmarshal(owned.Climbs, &climbs); err != nil {
		return nil, err
	}
	rides, err := s.store.Queries.ListTimedRouteSamples(r.Context(), db.ListTimedRouteSamplesParams{UserID: user.ID, RouteKey: &key})
	if err != nil {
		return nil, err
	}
	metres := make(map[string][]float64, len(rides))
	for _, ride := range rides {
		samples, err := stats.DecodeSamples(ride.Samples)
		if err != nil {
			s.log.Warn("route attempt samples unreadable", "err", err, "ride", store.UUIDString(ride.ID))
			continue
		}
		metres[store.UUIDString(ride.ID)] = metresOf(samples)
	}
	bests := []climbBestJSON{}
	for _, c := range climbs {
		if c.Cls == nil {
			continue
		}
		best := climbBestJSON{StartM: c.StartM, TopM: c.TopM, Cls: *c.Cls}
		for _, ride := range rides {
			id := store.UUIDString(ride.ID)
			if t, ok := timeUp(metres[id], c.StartM, c.TopM); ok && (best.RideID == "" || t < best.Seconds) {
				best.Seconds, best.RideID = t, id
			}
		}
		if best.RideID != "" {
			bests = append(bests, best)
		}
	}
	return bests, nil
}

func (s *Service) handleGhost(w http.ResponseWriter, r *http.Request) {
	user, _, route, ok := s.ownRoute(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListRouteAttempts(r.Context(), db.ListRouteAttemptsParams{UserID: user.ID, RouteKey: &route.RoadHash})
	if err != nil {
		httpx.Fail(w, s.log, "list route attempts failed", err, "Your ghost could not be loaded.")
		return
	}
	ghost, best, found := ghostOf(rows, route.RoadHash, float64(route.LengthM), time.Now())
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "You have not ridden this road from its start yet — ride it once and you race yourself next time.")
		return
	}
	blob, err := s.store.Queries.GetOwnRideSamples(r.Context(), db.GetOwnRideSamplesParams{ID: ghost.ID, UserID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "ghost samples read failed", err, "Your ghost could not be loaded.")
		return
	}
	samples, err := stats.DecodeSamples(blob)
	if err != nil {
		httpx.Fail(w, s.log, "ghost samples unreadable", err, "Your ghost could not be loaded.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"rideId": store.UUIDString(ghost.ID), "startedAt": ghost.StartedAt.Time,
		"best": best, "seconds": ghost.Seconds, "metres": metresOf(samples),
	})
}

// ghostOf picks the ride you race on this road (#3033, ADR-0068): your
// fastest timeable ride of the whole road in the last 90 days, else your
// latest ride of it. Only a ride begun at the road's start, on this very road
// — or, from an older snapshot, one whose metres agree with the road's length
// — can be a ghost. The rows are the rider's own, so nobody else's ever is.
func ghostOf(rows []db.ListRouteAttemptsRow, roadHash string, lengthM float64, now time.Time) (db.ListRouteAttemptsRow, bool, bool) {
	complete := func(a db.ListRouteAttemptsRow) bool {
		return a.DistanceM != nil && math.Abs(float64(*a.DistanceM)-lengthM) <= ghostLengthTolerance*lengthM
	}
	var best, last *db.ListRouteAttemptsRow
	for i := range rows {
		a := &rows[i]
		fromStart := a.FromM == nil || *a.FromM == 0
		sameRoad := a.RoadH != nil && *a.RoadH == roadHash || complete(*a)
		if !fromStart || !sameRoad {
			continue
		}
		if last == nil {
			last = a // newest first
		}
		timed := a.Timeable != nil && *a.Timeable
		if timed && complete(*a) && now.Sub(a.StartedAt.Time) <= ghostWindow &&
			(best == nil || a.Seconds < best.Seconds) {
			best = a
		}
	}
	switch {
	case best != nil:
		return *best, true, true
	case last != nil:
		return *last, false, true
	}
	return db.ListRouteAttemptsRow{}, false, false
}

// metresOf is each second's place on the road, as the ride's samples carry it.
func metresOf(samples []protocol.RiderMetrics) []float64 {
	out := make([]float64, len(samples))
	for i, sample := range samples {
		out[i] = sample.M
	}
	return out
}

// timeUp is how long a ride took from one metre of the road to another, to a
// fraction of a second between its samples, rounded. False when it did not
// ride the whole stretch — a ride begun halfway up a climb timed none of it.
// A sample sitting on the metre counts as crossing it once the ride moves on,
// so a climb from the road's first metre is timed (#3635) and time spent
// standing at the foot is not.
func timeUp(metres []float64, from, to float64) (int, bool) {
	at := func(m float64) (float64, bool) {
		for i := 1; i < len(metres); i++ {
			if metres[i-1] <= m && metres[i] >= m && metres[i] > metres[i-1] {
				return float64(i-1) + (m-metres[i-1])/(metres[i]-metres[i-1]), true
			}
		}
		return 0, false
	}
	a, fromOK := at(from)
	b, toOK := at(to)
	if !fromOK || !toOK || b <= a {
		return 0, false
	}
	return int(math.Round(b - a)), true
}
