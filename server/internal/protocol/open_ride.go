package protocol

// Open rides (ADR-0076): a stranger is a shape at a speed — a per-ride id, a
// position, a speed and a coarse kit, never a name, a number or the look hash,
// which is stable and would link a stranger across rides (#3155). Every frame
// an open ride sends lives here, and TestAnOpenRideCarriesNothingAboutAnyone
// refuses a field named or typed for a person or a number.

// OpenRideSample is a rider's second, up at 1 Hz: what the bunch needs to move
// them, and no heart rate or cadence, which it does not.
type OpenRideSample struct {
	Seq   int `json:"seq"` // monotonic per ride, for reconnect dedup
	Watts int `json:"watts"`
	// The rider's trim on their own targets, MinBias–MaxBias; 0 is none.
	Bias float64 `json:"bias,omitempty"`
}

// OpenRideTick is the ride's one nameless frame a second, the same for every
// rider on it (ADR-0076 §11).
type OpenRideTick struct {
	At      int64  `json:"at"`    // server millis
	Phase   string `json:"phase"` // "pen" | "countIn" | "riding" | "done"
	Elapsed int    `json:"elapsed"`
	// The bunch on the library road (ADR-0065), in metres and metres a second.
	BunchM float64         `json:"bunchM"`
	Speed  float64         `json:"speed"`
	Riders []OpenRideRider `json:"riders"`
}

// OpenRideRider is one marker: the ride's id for a rider, and where they
// are. A group ride places them by offset from the bunch; a race format by
// their own metres and speed instead.
type OpenRideRider struct {
	E string `json:"e"`
	// From the bunch, in decimetres — World's unit.
	O int16   `json:"o,omitempty"`
	M float64 `json:"m,omitempty"`
	V float64 `json:"v,omitempty"`
}

// The coarse kit's two choices (docs/SPEC.md "Open rides"): a marker is told
// apart by one of these, never by a look.
const (
	OpenRideJerseys     = 12
	OpenRideSilhouettes = 6
)

// OpenRideKit is how a marker is drawn: a jersey colourway and a bike class,
// by index, and whether they lead the ride — set only for the host crew's
// owner and admins.
type OpenRideKit struct {
	Jersey     int  `json:"jersey"`
	Silhouette int  `json:"silhouette"`
	Leader     bool `json:"leader,omitempty"`
}

// OpenRideRoster is every marker's kit by ride id, down on join and on change,
// never on the tick. HostCrew is the host crew's name when the crew is listed
// (ADR-0039) and empty otherwise, which a client reads as "Hosted by a crew";
// it never names the person who opened the ride.
type OpenRideRoster struct {
	Kits     map[string]OpenRideKit `json:"kits"`
	HostCrew string                 `json:"hostCrew,omitempty"`
}

// OpenRideNames maps ride ids to rider ids, sent only to the viewer's own
// people — those who share a crew with them — and refreshed every 60 s.
type OpenRideNames struct {
	Riders map[string]string `json:"riders"`
}

// A leader's calls, the closed set docs/SPEC.md "Open rides" names: never free
// text, at most one per 20 s per ride.
const (
	OpenRideCallWelcome      = "welcome"
	OpenRideCallClimbAhead   = "climbAhead"
	OpenRideCallStayTogether = "stayTogether"
	OpenRideCallLast5Km      = "last5km"
	OpenRideCallSprintSign   = "sprintAtTheSign"
	OpenRideCallThanks       = "thanks"
)

// OpenRideCall is one leader call, by its code.
type OpenRideCall struct {
	Code string `json:"code"`
}

// OpenRideClosing is the closing card (ADR-0076 §9): counts, and in a race
// format the viewer's own placing, once — never a list, never stored.
type OpenRideClosing struct {
	Riders     int  `json:"riders"`
	Crews      int  `json:"crews"`
	Alone      bool `json:"alone,omitempty"`
	OwnPlacing *int `json:"ownPlacing,omitempty"`
}
