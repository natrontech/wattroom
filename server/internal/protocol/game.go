package protocol

// SprintScore is one rider's place on the mini-podium.
type SprintScore struct {
	RiderID string  `json:"riderId"`
	Name    string  `json:"name"`
	Wkg     float64 `json:"wkg"`
	Watts   int     `json:"watts"`
	// Ramp modes (#1593): the rounds the rider survived — the number the
	// podium shows, where Wkg is only a placing score.
	Rounds int `json:"rounds,omitempty"`
}

// SprintState rides the tick while a sprint moment is armed, live, or just
// scored. Times are server-clock millis, the same clock as ServerTick.At —
// clients render the klaxon countdown and the window from these anchors.
type SprintState struct {
	StartsAtMs int64 `json:"startsAtMs"`
	EndsAtMs   int64 `json:"endsAtMs"`
	// Filled once the window closes; podium order.
	Results []SprintScore `json:"results,omitempty"`
}

// GameRider is one rider's standing inside a game mode.
type GameRider struct {
	Eliminated bool    `json:"eliminated,omitempty"`
	Lives      int     `json:"lives,omitempty"`
	Score      float64 `json:"score,omitempty"`
	OnFront    bool    `json:"onFront,omitempty"`
	// The rider's personal target as a fraction of their FTP; 0 = ride free.
	TargetPct float64 `json:"targetPct,omitempty"`
}

// GameState is a running game mode on the tick (#31). One generic shape for
// all seven modes: the client renders labels per mode, the server owns every
// rule. Riders execute their own %FTP targets, so mixed groups stay fair.
type GameState struct {
	Mode  string `json:"mode"`
	Phase string `json:"phase"` // "running" | "done"
	Round int    `json:"round,omitempty"`
	// The shared line as a fraction of FTP (ramp modes), the called zone
	// (lava), or the hole target pct (golf) — mode-dependent, one at a time.
	LinePct       float64 `json:"linePct,omitempty"`
	CalledZone    int     `json:"calledZone,omitempty"`
	RoundEndsAtMs int64   `json:"roundEndsAtMs,omitempty"`
	// Sprint Roulette's window opens here (#1578): the length is random, so
	// the client cannot derive the 3-2-1 from the end alone.
	RoundStartsAtMs int64                `json:"roundStartsAtMs,omitempty"`
	MeterHidden     bool                 `json:"meterHidden,omitempty"`
	TeamDistance    float64              `json:"teamDistance,omitempty"`
	Riders          map[string]GameRider `json:"riders"`
	Podium          []SprintScore        `json:"podium,omitempty"`
}
