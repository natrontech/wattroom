package crews

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/routes"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// A plan's road (#3051, ADR-0063): the workout names its route by reference,
// the planner has to own it, and every reader gets the road cut to them.

// SetRoads wires the routes in; without them a plan may name no road.
func (s *Service) SetRoads(a *routes.Attacher) { s.roads = a }

// planRoad checks a plan's road — the planner's own route, and never one
// from Strava, since the crew reads it — and answers the route for the
// plan's row, null when the workout rides none. False when it wrote the
// refusal.
func (s *Service) planRoad(w http.ResponseWriter, r *http.Request, workoutJSON string, planner pgtype.UUID) (pgtype.UUID, bool) {
	if s.roads == nil {
		if ref, _ := workout.RoadOf(workoutJSON); ref != nil {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"This server does not ride roads yet, so a plan cannot carry one.", "workoutJson")
			return pgtype.UUID{}, false
		}
		return pgtype.UUID{}, true
	}
	id, err := s.roads.CheckShared(r.Context(), workoutJSON, planner)
	var refused routes.Refused
	if errors.As(err, &refused) {
		httpx.WriteFieldError(w, http.StatusForbidden, "forbidden", string(refused), "workoutJson")
		return pgtype.UUID{}, false
	}
	if err != nil {
		httpx.Fail(w, s.log, "plan road check failed", err, "The session could not be planned. Try again.")
		return pgtype.UUID{}, false
	}
	return id, true
}

// readable is a plan's workout as viewer may read it: its road cut to them.
// A road that cannot be read goes out as its bare reference and nothing
// more — never the owner's cut to someone else.
func (s *Service) readable(ctx context.Context, workoutJSON []byte, viewer pgtype.UUID) string {
	if s.roads == nil {
		return string(workoutJSON)
	}
	out, err := s.roads.Attach(ctx, string(workoutJSON), viewer)
	if err != nil {
		s.log.Warn("plan road unreadable", "err", err)
		return string(workoutJSON)
	}
	return out
}

// sessionCut is a plan's workout as its session sends it to every socket
// (#3512): the crew's cut of its road — the planner's own route, checked when
// it was planned — never the bare reference, which no crewmate can ride. A
// road that cannot be cut refuses the start, as the hub refuses a pick
// (hub.sessionRoad). False when it wrote the refusal.
func (s *Service) sessionCut(w http.ResponseWriter, r *http.Request, workoutJSON []byte) (string, bool) {
	if ref, _ := workout.RoadOf(string(workoutJSON)); ref == nil {
		return string(workoutJSON), true
	}
	if s.roads == nil {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"This server does not ride roads yet, so a session cannot carry one.")
		return "", false
	}
	out, err := s.roads.Attach(r.Context(), string(workoutJSON), pgtype.UUID{})
	if err != nil {
		httpx.Fail(w, s.log, "plan road cut failed", err, "The road could not be read just now. Start the session again in a moment.")
		return "", false
	}
	return out, true
}
