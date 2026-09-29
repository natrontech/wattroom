package protocol

// ControlRoute is the road a pick or a game rides (#3095, ADR-0065): one of
// the coach's own routes, where on it the bunch starts, which way it runs,
// and whether it rides again from the start when it reaches the end.
type ControlRoute struct {
	ID string `json:"id"`
	// Metres along the road as the crew rides it — the span between its
	// anchors (ADR-0063) — in the direction ridden.
	FromM   float64 `json:"fromM,omitempty"`
	Reverse bool    `json:"reverse,omitempty"`
	Loop    bool    `json:"loop,omitempty"`
}

// SessionRoute is the road a session rides, by reference: never the road
// itself, which every socket fetches by Hash as the crew's cut (#3096). One
// frame for everyone — the coach who owns the route included — so a restart
// (ADR-0052) re-picks FromM and the bunch comes back where it was.
type SessionRoute struct {
	ID string `json:"id"`
	// The stored road's hash, the key a client caches the crew's cut under.
	Hash string `json:"hash"`
	// docs/SPEC.md's generated name ("Road · 52.9 km · 1,312 m"), never the
	// owner's own, which may name the place the route's ends hide.
	GenName string  `json:"genName"`
	FromM   float64 `json:"fromM"`
	Reverse bool    `json:"reverse,omitempty"`
	// The crew's cut, the length every metre above is bounded by.
	LengthM float64 `json:"lengthM"`
	Loop    bool    `json:"loop,omitempty"`
}

// World is the bunch on the session's road (ADR-0065), on every tick while
// one rides it: one position, advanced once per whole second, and each
// rider's elastic place around it. Never ranked (ADR-0036) — an offset is
// where a figure stands, not a gap anyone is told about.
type World struct {
	BunchM   float64 `json:"bunchM"`
	SpeedMps float64 `json:"speedMps"`
	// Laps completed on a looped road.
	Lap int `json:"lap,omitempty"`
	// Each joined rider's place from the bunch in decimetres, by rider id.
	Offsets map[string]int16 `json:"offsets,omitempty"`
	// Riders coasting back to the bunch's tail (docs/SPEC.md "Riding a road
	// together"), by rider id.
	Resting []string `json:"resting,omitempty"`
}
