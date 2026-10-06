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
	// Where the crew's cut begins on the stored road (#3722): the first
	// height step past the hidden end. Server-only — the hub keeps a race
	// rider's ride in the stored road's metres, as every ride of it is.
	CutFromM float64 `json:"-"`
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
	// The joined riders in the order they joined the bunch, those who joined
	// in one second by id (#3098): the formation's slots, so every screen
	// draws one bunch and a late joiner rides in at its back.
	Order []string `json:"order,omitempty"`
	// Each racer's own place in a race (#3032, ADR-0067), by rider id: a
	// race rides no shared bunch. Races only.
	Racers map[string]RaceRider `json:"racers,omitempty"`
}

// RaceRider is one racer on the tick: metres from the km-0 klaxon, their
// speed, and when they crossed the line — to the millisecond, inside the
// second they crossed it in — once they have. On the race's clock: the
// klaxon plus their racing time, so a span the coach neutralised after the
// klaxon is not in it.
type RaceRider struct {
	M        float64 `json:"m"`
	V        float64 `json:"v"`
	FinishMs int64   `json:"finishMs,omitempty"`
	// The Category the race froze them in at the flag, D–A (#3174): who they
	// race, which the RACE page places them among. The bracket, never the
	// watts behind it.
	Cat string `json:"cat,omitempty"`
	// Seconds ahead of their Category's par at their metre, behind when
	// negative (#3174): par from their own start, on their own racing clock.
	// Absent until they have raced a second.
	Par float64 `json:"par,omitempty"`
}
