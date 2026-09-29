package protocol

// Control is a coach/owner command over the shared session (SPEC roles matrix:
// pick workout, start countdown, pause/end). The server enforces the role.
type Control struct {
	Action string `json:"action"` // "pick" | "start" | "pause" | "resume" | "end" | "handoff" | "game" | "game-end" | "sprint" | "join" | "leave"
	// Workout definition, opaque to the server: the docs/SPEC.md JSON as a
	// string. The server owns the clock, the clients own the targets.
	WorkoutName string `json:"workoutName,omitempty"`
	WorkoutJSON string `json:"workoutJson,omitempty"`
	// Total length in seconds, so the server can end the session on time
	// without parsing the workout.
	TotalSeconds int `json:"totalSeconds,omitempty"`
	// For action "game": which mode to start.
	GameMode string `json:"gameMode,omitempty"`
	// For action "handoff": the rider id the session's coach hands it to
	// (#2438) — someone in the voice channel.
	Rider string `json:"rider,omitempty"`
}

// IsControlAction reports whether s is one of Control.Action's words — the
// session controls a client may send. The hub checks it before anything else
// in a control frame (#3019): the action is part of that rider's rate-limit
// key, and a string the client chose must not be able to grow the room's map
// of allowances without bound. A new action is added here and to the comment
// on Control.Action together.
func IsControlAction(s string) bool {
	switch s {
	case "pick", "start", "pause", "resume", "end", "handoff",
		"game", "game-end", "sprint", "join", "leave":
		return true
	}
	return false
}
