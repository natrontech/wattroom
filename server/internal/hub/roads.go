package hub

import (
	"context"
	"time"

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
