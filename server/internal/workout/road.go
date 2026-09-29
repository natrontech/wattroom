package workout

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// RoadRef is a workout's road (#3051, ADR-0062): a reference to a stored
// route and the stretch of it the workout rides — never the road itself. A
// profile copied into a plan or into another rider's row could not be erased
// with the route, and its turns integrate back to the route's shape, zones
// and all. The server attaches the audience's cut of the road on read.
type RoadRef struct {
	RouteID string  `json:"routeId"`
	FromM   float64 `json:"fromM"`
	ToM     float64 `json:"toM"`
	// Where each block of a road workout ends, in metres along the road.
	StepEndM []float64 `json:"stepEndM,omitempty"`
}

// RoadOf reads a workout's road reference, nil when it rides none. It is
// strict: a road carrying anything beside the reference — a profile, heights,
// a shape — is refused, so no client can plant a copy where the route's
// erasure would not reach it.
func RoadOf(workoutJSON string) (*RoadRef, error) {
	var outer struct {
		Road json.RawMessage `json:"road"`
	}
	if err := json.Unmarshal([]byte(workoutJSON), &outer); err != nil {
		return nil, refusal("That is not a workout the engine can ride.")
	}
	if len(outer.Road) == 0 || bytes.Equal(outer.Road, []byte("null")) {
		return nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader(outer.Road))
	dec.DisallowUnknownFields()
	var ref RoadRef
	if err := dec.Decode(&ref); err != nil {
		return nil, refusal("A workout carries its road by reference only — the route and where on it, never the road's heights or its shape.")
	}
	return &ref, checkRoad(ref)
}

func checkRoad(r RoadRef) error {
	if _, err := uuid.Parse(r.RouteID); err != nil {
		return refusal("A workout's road names no route.")
	}
	if r.FromM < 0 || r.ToM <= r.FromM || r.ToM > protocol.MaxRouteMeters {
		return refusal(fmt.Sprintf("A workout's road runs forward, within %d km.", protocol.MaxRouteMeters/1000))
	}
	if len(r.StepEndM) > maxSegments {
		return ErrTooBig
	}
	prev := r.FromM
	for _, end := range r.StepEndM {
		if end <= prev || end > r.ToM {
			return refusal("A road workout's blocks end in order, along the stretch it rides.")
		}
		prev = end
	}
	return nil
}
