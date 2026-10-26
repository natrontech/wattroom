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
	raw, err := roadJSON(workoutJSON)
	if err != nil {
		return nil, refusal("That is not a workout the engine can ride.")
	}
	if raw == nil {
		return nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var ref RoadRef
	if err := dec.Decode(&ref); err != nil {
		return nil, refusal("A workout carries its road by reference only — the route and where on it, never the road's heights or its shape.")
	}
	return &ref, checkRoad(ref)
}

// OnRoad says whether a workout rides a road at all. It reads leniently,
// unlike RoadOf: a client saves the copy it was handed, the cut attached
// beside the reference, and that is still a road (#4154).
func OnRoad(workoutJSON string) bool {
	raw, err := roadJSON(workoutJSON)
	return err == nil && raw != nil
}

// roadJSON is a workout's road as it was written, nil when it rides none.
func roadJSON(workoutJSON string) (json.RawMessage, error) {
	var outer struct {
		Road json.RawMessage `json:"road"`
	}
	if err := json.Unmarshal([]byte(workoutJSON), &outer); err != nil {
		return nil, err
	}
	if len(outer.Road) == 0 || bytes.Equal(outer.Road, []byte("null")) {
		return nil, nil
	}
	return outer.Road, nil
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

// PlainName is a workout's name where no place may travel, generated or not
// (ADR-0063: email, ICS, the Strava title). A road goes as its length alone:
// its generated name may one day name places along it (#4154). A road that
// cannot be read is still a road, and says no more.
func PlainName(workoutJSON, name string) string {
	ref, err := RoadOf(workoutJSON)
	switch {
	case err != nil:
		return RouteRide(0)
	case ref == nil:
		return name
	}
	return RouteRide(ref.ToM - ref.FromM)
}

// RouteRide is a route ride's name where no place may travel: its length,
// or no more than what it is when that is not known.
func RouteRide(lengthM float64) string {
	if lengthM <= 0 {
		return "Route ride"
	}
	return fmt.Sprintf("Route ride · %.1f km", lengthM/1000)
}
