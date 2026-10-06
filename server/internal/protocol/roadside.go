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
	// What a paint verb chalks; empty for a stand.
	Stamp RoadsideStamp `json:"stamp,omitempty"`
	// Whose initial a RoadsideStampInitial chalks: a rider riding the session.
	For string `json:"for,omitempty"`
}

// RoadsideKind is the closed set of roadside verbs. Anything else is refused
// at the socket.
type RoadsideKind string

const (
	// RoadsideKindStand is where a spectator watches from: ahead of the
	// bunch, moved at most once a minute, frozen as the riders close on it,
	// and gone once they pass it (docs/SPEC.md "The roadside").
	RoadsideKindStand RoadsideKind = "stand"
	// RoadsideKindPaint chalks a stamp on a climb ahead of the riders, one
	// per climb (docs/SPEC.md "The roadside").
	RoadsideKindPaint RoadsideKind = "paint"
)

// RoadsideStamp is the closed set of chalk a spectator may paint (Jan,
// 2026-10-06): nothing typed, so nothing to moderate.
type RoadsideStamp string

const (
	RoadsideStampArrow   RoadsideStamp = "arrow"
	RoadsideStampHeart   RoadsideStamp = "heart"
	RoadsideStampAllez   RoadsideStamp = "allez"
	RoadsideStampHopp    RoadsideStamp = "hopp"
	RoadsideStampCowbell RoadsideStamp = "cowbell"
	RoadsideStampInitial RoadsideStamp = "initial"
)

// RoadsideStamps is every stamp, in the order a deck offers them.
var RoadsideStamps = []RoadsideStamp{
	RoadsideStampArrow, RoadsideStampHeart, RoadsideStampAllez,
	RoadsideStampHopp, RoadsideStampCowbell, RoadsideStampInitial,
}

// RoadsideState is what the roadside has put on the session's road, on the
// tick while a bunch rides it. Rev moves with every change — a stand placed,
// moved, passed or let go, a stamp painted or passed — so a client redraws
// only when it does.
type RoadsideState struct {
	Rev    int64           `json:"rev"`
	Stands []RoadsideStand `json:"stands,omitempty"`
	Paint  []RoadsidePaint `json:"paint,omitempty"`
}

// RoadsideStand is one spectator's stand, where Roadside put it.
type RoadsideStand struct {
	RiderID string  `json:"riderId"`
	AtM     float64 `json:"atM"`
	Lap     int     `json:"lap,omitempty"`
}

// RoadsidePaint is one chalk stamp on the road, still ahead of the riders.
type RoadsidePaint struct {
	RiderID string        `json:"riderId"`
	Stamp   RoadsideStamp `json:"stamp"`
	For     string        `json:"for,omitempty"`
	AtM     float64       `json:"atM"`
	Lap     int           `json:"lap,omitempty"`
}

// docs/SPEC.md "The roadside" (defaults — tune in alpha): a stand is 300 m –
// 5 km ahead of the bunch, and moves at most once a minute; a spectator
// paints 6 stamps a ride, at most 12 lie on the road at once, and a ride
// takes at most 24 marks.
const (
	RoadsideStandMinAheadM   = 300
	RoadsideStandMaxAheadM   = 5000
	RoadsideStandMoveSeconds = 60
	RoadsidePaintPerRide     = 6
	RoadsidePaintLive        = 12
	RoadsideMarksPerRide     = 24
)
