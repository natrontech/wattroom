package hub

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// Roads cuts a picked workout's road for its channel (#3051, ADR-0063): the
// coach's own route, never one from Strava, and every socket in the channel
// is sent the crew's cut of it, never the owner's. Defined here, where it is
// consumed; routes.Attacher implements it.
type Roads interface {
	// ForSession answers the workout with the crew's cut attached, or the
	// refusal the coach is told, or the error that kept it from being read.
	ForSession(ctx context.Context, coach, workoutJSON string) (attached, refusal string, err error)
	// SessionRoute describes the road a session rides (#3095) as the crew
	// rides it, or the refusal the coach is told, or the error that kept
	// it from being read.
	SessionRoute(ctx context.Context, coach, routeID string) (protocol.SessionRoute, *protocol.Error, error)
}

// SetRoads wires the routes in. Nil rides no roads: a pick carrying one is
// refused rather than sent out bare.
func (h *Hub) SetRoads(r Roads) { h.roads = r }

// How long a pick may wait on its road. The pick is handled on the socket's
// read loop, which hands down no context of its own — bounded like the
// socket's writes.
const roadReadTimeout = 5 * time.Second

// sessionRoad is a pick's workout as the channel may read it: unchanged when
// it rides no road, else with the crew's cut attached. A refusal is for the
// coach.
func (h *Hub) sessionRoad(workoutJSON, coach string) (string, string) {
	if ref, _ := workout.RoadOf(workoutJSON); ref == nil {
		return workoutJSON, ""
	}
	if h.roads == nil {
		return "", "This server does not ride roads yet, so a session cannot carry one."
	}
	ctx, cancel := context.WithTimeout(context.Background(), roadReadTimeout)
	defer cancel()
	attached, refusal, err := h.roads.ForSession(ctx, coach, workoutJSON)
	if err != nil {
		h.log.Warn("pick road unreadable", "err", err, "coach", coach)
		return "", "The road could not be read just now. Pick it again in a moment."
	}
	return attached, refusal
}

// sessionRoute resolves the road a pick or a game asks to ride (#3095),
// before the room's lock: the coach's own route, never Strava's, with the
// start inside the crew's cut. A refusal is for the coach, in errors.md's
// codes.
func (h *Hub) sessionRoute(ask protocol.ControlRoute, workoutJSON, coach string) (protocol.SessionRoute, *protocol.Error) {
	refuse := func(code, message string) (protocol.SessionRoute, *protocol.Error) {
		return protocol.SessionRoute{}, &protocol.Error{Code: code, Message: message}
	}
	id, err := uuid.Parse(ask.ID)
	if err != nil {
		return refuse("validation_error", "A session's road names no route.")
	}
	if ask.FromM < 0 {
		return refuse("validation_error", "A session starts on its road, not before it.")
	}
	// A workout built on a road ends its blocks at that road's metres.
	if ref, err := workout.RoadOf(workoutJSON); err == nil && ref != nil {
		if built, _ := uuid.Parse(ref.RouteID); built != id {
			return refuse("validation_error", "This workout was built on another road — pick the route it rides.")
		}
	}
	if h.roads == nil {
		return refuse("forbidden", "This server does not ride roads yet, so a session cannot carry one.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), roadReadTimeout)
	defer cancel()
	route, refusal, err := h.roads.SessionRoute(ctx, coach, id.String())
	if err != nil {
		h.log.Warn("session route unreadable", "err", err, "coach", coach, "route", id)
		return refuse("internal_error", "The road could not be read just now. Pick it again in a moment.")
	}
	if refusal != nil {
		return protocol.SessionRoute{}, refusal
	}
	if ask.FromM >= route.LengthM {
		return refuse("validation_error", fmt.Sprintf("A session starts within its road — before %.1f km.", route.LengthM/1000))
	}
	route.FromM, route.Reverse, route.Loop = ask.FromM, ask.Reverse, ask.Loop
	return route, nil
}
