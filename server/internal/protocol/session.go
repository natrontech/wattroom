package protocol

// SessionState is the shared timeline, server-owned. Late joiners need no
// catch-up protocol: every tick carries the whole truth — except the workout
// definition, which is named by hash on every tick and sent in full only to
// a socket that has not seen that hash (its first tick, the tick after a
// pick), so a 64 KiB definition does not ride every second at 1–4 Hz (#1710).
type SessionState struct {
	Phase string `json:"phase"` // "idle" | "countdown" | "running" | "paused" | "done"
	// The session's id while one is open in this voice channel (#2438):
	// from the pick that opened it until the next one replaces it. Empty
	// while nobody has opened one.
	ID string `json:"id,omitempty"`
	// Who is coaching it, by rider id and by name (#2438): whoever opened
	// it, until they hand it off. The one rider whose controls the server
	// takes, besides the crew's owner and admins ending it.
	Coach     string `json:"coach,omitempty"`
	CoachName string `json:"coachName,omitempty"`
	// Seconds into the workout timeline. Advances only while running.
	Elapsed int `json:"elapsed"`
	// Seconds until the timeline starts, while in countdown.
	CountdownRemaining int    `json:"countdownRemaining,omitempty"`
	WorkoutName        string `json:"workoutName,omitempty"`
	WorkoutJSON        string `json:"workoutJson,omitempty"`
	// Names WorkoutJSON on the wire (#1710). A client keeps the last
	// definition it heard and fills it back in while the hash matches.
	WorkoutHash  string `json:"workoutHash,omitempty"`
	TotalSeconds int    `json:"totalSeconds,omitempty"`
	// The rpm the current block asks the session's riders to turn (#1431):
	// the block's cadence band, else docs/SPEC.md's effort tiers. 0 while
	// nothing runs or the block expresses no preference. What smart autoplay
	// weighs against, said on the wire so a queue row can show which tracks
	// fit.
	TargetRpm int `json:"targetRpm,omitempty"`
	// The road the session rides (#3095), from the pick or the game that
	// opened it; absent on a session with no road.
	Route *SessionRoute `json:"route,omitempty"`
}

// SessionRecapRider is one person a session saw, and when — the only two
// things a recap may say about anybody (ADR-0034). No watts, no kJ, no
// execution, no heart rate, no per-rider workout: everyone in the voice
// channel watched the roster, so the card writes down what they already saw,
// and WATTROOM.md's metrics rules stay exactly where they are.
type SessionRecapRider struct {
	// The rider's user id, so the client can key a row and an account purge
	// can find the intervals it has to remove. A display name identifies
	// nobody reliably.
	ID    string `json:"id"`
	Rider string `json:"rider"`
	// Unix millis: first and last time the session saw them present.
	From int64 `json:"from"`
	To   int64 `json:"to"`
	// They have a ride row for this session — a filled pip. False is the
	// coach without a trainer, or the person on the sofa in voice.
	Rode bool `json:"rode"`
}

// SessionRecap is what a finished session leaves behind (ADR-0034): the first
// thing in this app that survives a reload of a session's timeline. Written
// once when the session ends, rendered as one collapsed card the chat pane
// merges in by timestamp — the artifact ADR-0022 said to build if riders ever
// asked, rather than the persisted event stream it refused.
type SessionRecap struct {
	ID      string `json:"id"`
	Workout string `json:"workout"`
	// Unix millis, the shared timeline's own clock.
	StartedAt int64               `json:"startedAt"`
	EndedAt   int64               `json:"endedAt"`
	Riders    []SessionRecapRider `json:"riders"`
	// The VIEWER's own ride from this session, if they rode it — never
	// anybody else's (#1560). The card still carries no numbers, and none of
	// ADR-0034's four settled points move: this is a door to the page where
	// the rider's own numbers already live, filled per request and stored
	// nowhere. Empty for the coach without a trainer, and on the tick that
	// posts the recap, where the ride has not been written yet.
	RideID string `json:"rideId,omitempty"`
	// The session it recaps and the voice channel it ran in (#2600), where
	// the recap row keeps them: an ended session's address finds its way
	// back to the channel through these. Empty on a recap from before M9.
	SessionID string `json:"sessionId,omitempty"`
	ChannelID string `json:"channelId,omitempty"`
}

// LiveSession is one session running in a crew's voice channel (#2438), as
// GET /api/crews/{id}/live answers it — only for channels the caller may
// enter, like every other live read.
type LiveSession struct {
	ID        string `json:"id"`
	Channel   string `json:"channel"`
	Workout   string `json:"workout"`
	Phase     string `json:"phase"` // "countdown" | "running" | "paused"
	Elapsed   int    `json:"elapsed"`
	Coach     string `json:"coach"`
	CoachName string `json:"coachName"`
	// Who rides it (ADR-0059): joined, and in the channel now — by name and
	// by id in the same order. A spectator standing in the channel is not
	// here (#2853).
	Riders   []string `json:"riders"`
	RiderIDs []string `json:"riderIds"`
}
