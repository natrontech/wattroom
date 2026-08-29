// Package protocol defines the WebSocket message types. These Go structs are
// the single source of truth; `make protocol` generates the TypeScript types
// via tygo (see WATTROOM.md decisions: WS protocol).
package protocol

// RiderMetrics is one rider's live sample, sent client -> server at ~1 Hz.
type RiderMetrics struct {
	Watts   int `json:"watts"`
	HR      int `json:"hr,omitempty"`
	Cadence int `json:"cadence,omitempty"`
	Seq     int `json:"seq"` // monotonic per ride, for reconnect dedup
}

// Control is a coach/owner command over the shared session (SPEC roles matrix:
// pick workout, start countdown, pause/end). The server enforces the role.
type Control struct {
	Action string `json:"action"` // "pick" | "start" | "pause" | "resume" | "end"
	// Workout definition, opaque to the server: the docs/SPEC.md JSON as a
	// string. The server owns the clock, the clients own the targets.
	WorkoutName string `json:"workoutName,omitempty"`
	WorkoutJSON string `json:"workoutJson,omitempty"`
	// Total length in seconds, so the server can end the session on time
	// without parsing the workout.
	TotalSeconds int `json:"totalSeconds,omitempty"`
}

// Backfill is a reconnect's replay: samples the client buffered while the
// socket was down (WATTROOM.md crash safety). The server dedupes by Seq, so
// resending is always safe and never double-counts.
type Backfill struct {
	Samples []RiderMetrics `json:"samples"`
}

// ClientMessage is the envelope for everything a client sends.
type ClientMessage struct {
	Metrics  *RiderMetrics `json:"metrics,omitempty"`
	Control  *Control      `json:"control,omitempty"`
	Backfill *Backfill     `json:"backfill,omitempty"`
}

// Rider is presence: who is in the room right now, with what the dashboard
// needs to render them. FTP crosses the wire so every screen can show %FTP —
// room-scoped by design, the same visibility WATTROOM.md grants live watts.
type Rider struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	FtpWatts int    `json:"ftpWatts"`
	// For w/kg on room screens — room-scoped like FTP, and for the same reason:
	// every contest in docs/SPEC.md is scored on it.
	WeightKg int `json:"weightKg"`
}

// SessionState is the shared timeline, server-owned. Late joiners need no
// catch-up protocol: every tick carries the whole truth.
type SessionState struct {
	Phase string `json:"phase"` // "idle" | "countdown" | "running" | "paused" | "done"
	// Seconds into the workout timeline. Advances only while running.
	Elapsed int `json:"elapsed"`
	// Seconds until the timeline starts, while in countdown.
	CountdownRemaining int    `json:"countdownRemaining,omitempty"`
	WorkoutName        string `json:"workoutName,omitempty"`
	WorkoutJSON        string `json:"workoutJson,omitempty"`
	TotalSeconds       int    `json:"totalSeconds,omitempty"`
}

// ServerTick is the coalesced 1 Hz room broadcast: every rider's latest
// sample, the roster, and the shared session state.
type ServerTick struct {
	At     int64                   `json:"at"` // unix millis
	State  SessionState            `json:"state"`
	Roster []Rider                 `json:"roster"`
	Riders map[string]RiderMetrics `json:"riders"`
}

// Error tells a client why its connection or command was refused.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ServerMessage is the envelope for everything the server sends.
type ServerMessage struct {
	Tick  *ServerTick `json:"tick,omitempty"`
	Error *Error      `json:"error,omitempty"`
}
