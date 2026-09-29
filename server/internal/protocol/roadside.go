package protocol

// Roadside is one roadside verb (ADR-0064, #3029): something a spectator
// puts on the session's road. It paints, sounds and informs, and nothing it
// does reaches a rider's trainer, place or score. A refused one is answered
// with a `roadside_` code.
type Roadside struct {
	Kind RoadsideKind `json:"kind"`
	// Where on the road, in metres along the crew's cut in the direction
	// ridden, as World.BunchM reads it; Lap counts a looped road's laps.
	AtM float64 `json:"atM"`
	Lap int     `json:"lap,omitempty"`
}

// RoadsideKind is the closed set of roadside verbs. Anything else is refused
// at the socket.
type RoadsideKind string

// RoadsideKindStand is where a spectator watches from: ahead of the bunch,
// moved at most once a minute, frozen as the riders close on it, and gone
// once they pass it (docs/SPEC.md "The roadside").
const RoadsideKindStand RoadsideKind = "stand"

// RoadsideState is what the roadside has put on the session's road, on the
// tick while a bunch rides it. Rev moves with every change — a stand placed,
// moved, passed or let go — so a client redraws only when it does.
type RoadsideState struct {
	Rev    int64           `json:"rev"`
	Stands []RoadsideStand `json:"stands,omitempty"`
}

// RoadsideStand is one spectator's stand, where Roadside put it.
type RoadsideStand struct {
	RiderID string  `json:"riderId"`
	AtM     float64 `json:"atM"`
	Lap     int     `json:"lap,omitempty"`
}

// docs/SPEC.md "The roadside" (defaults — tune in alpha): a stand is 300 m –
// 5 km ahead of the bunch, and moves at most once a minute.
const (
	RoadsideStandMinAheadM   = 300
	RoadsideStandMaxAheadM   = 5000
	RoadsideStandMoveSeconds = 60
)
