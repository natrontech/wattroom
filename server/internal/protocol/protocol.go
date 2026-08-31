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

// SprintScore is one rider's place on the mini-podium.
type SprintScore struct {
	RiderID string  `json:"riderId"`
	Name    string  `json:"name"`
	Wkg     float64 `json:"wkg"`
	Watts   int     `json:"watts"`
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
	LinePct       float64              `json:"linePct,omitempty"`
	CalledZone    int                  `json:"calledZone,omitempty"`
	RoundEndsAtMs int64                `json:"roundEndsAtMs,omitempty"`
	MeterHidden   bool                 `json:"meterHidden,omitempty"`
	RoomDistance  float64              `json:"roomDistance,omitempty"`
	Riders        map[string]GameRider `json:"riders"`
	Podium        []SprintScore        `json:"podium,omitempty"`
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
	// For action "game": which mode to start.
	GameMode string `json:"gameMode,omitempty"`
}

// Backfill is a reconnect's replay: samples the client buffered while the
// socket was down (WATTROOM.md crash safety). The server dedupes by Seq, so
// resending is always safe and never double-counts.
type Backfill struct {
	Samples []RiderMetrics `json:"samples"`
}

// JukeboxCommand is any member's jukebox action — the matrix defaults
// play/pause/skip to members, and adding is everyone's.
type JukeboxCommand struct {
	Action  string `json:"action"` // "add" | "remove" | "play" | "pause" | "skip" | "seek" | "ended" | "jam"
	VideoID string `json:"videoId,omitempty"`
	Title   string `json:"title,omitempty"`
	// For "seek": the new shared playhead. For "add": start the entry here
	// (a pasted ?t= timestamp) — 0 means the beginning, like any URL.
	PositionSec float64 `json:"positionSec,omitempty"`
	// For action "jam" (#96, ADR-0003): a Spotify Jam invite link the room
	// shows as a join card. Empty clears it. Link-out only — no API, ever.
	JamURL string `json:"jamUrl,omitempty"`
}

// ChatLine is one ephemeral room message (#146, ADR-0010): room-scoped,
// never persisted — it rides the tick like cheers and dies with the page.
// Warm-up and phone talk; mid-effort stays the cheers' job.
type ChatLine struct {
	// Persisted identity (ADR-0010 amended, #201) — what reactions attach to.
	// Empty when the server runs without a database.
	ID   string `json:"id,omitempty"`
	From string `json:"from"` // filled by the server, like cheers
	Text string `json:"text"`
	At   int64  `json:"at"` // server millis, for ordering only
}

// ChatReact toggles one rider's emoji on one message (#201) — the cheer
// vocabulary, attached instead of thrown.
type ChatReact struct {
	MessageID string `json:"messageId"`
	Emoji     string `json:"emoji"`
}

// ChatReactionCount is a changed total, broadcast on the tick. "Did I react"
// is the client's own knowledge — the shared tick carries only the count.
type ChatReactionCount struct {
	MessageID string `json:"messageId"`
	Emoji     string `json:"emoji"`
	Count     int    `json:"count"`
}

// Cheer is the room's reaction layer (#74) — and the spectator's one verb.
type Cheer struct {
	Emoji string `json:"emoji"`
	// Sender name, filled by the server: cheering is presence.
	From string `json:"from,omitempty"`
}

// ClientMessage is the envelope for everything a client sends.
type ClientMessage struct {
	Chat      *ChatLine       `json:"chat,omitempty"`
	ChatReact *ChatReact      `json:"chatReact,omitempty"`
	Cheer     *Cheer          `json:"cheer,omitempty"`
	Metrics   *RiderMetrics   `json:"metrics,omitempty"`
	Control   *Control        `json:"control,omitempty"`
	Backfill  *Backfill       `json:"backfill,omitempty"`
	Jukebox   *JukeboxCommand `json:"jukebox,omitempty"`
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

type JukeboxEntry struct {
	VideoID string `json:"videoId"`
	Title   string `json:"title"`
	AddedBy string `json:"addedBy"`
	// Where playback begins when this entry reaches the deck (?t= paste).
	StartSec float64 `json:"startSec,omitempty"`
}

// JukeboxState is the server's truth about what plays where. Clients chase the
// anchor: position = PositionSec, plus wall time since AnchorMs while playing.
// The audio itself is local per rider — their iframe, their volume — and never
// enters the voice path (SPEC room audio defaults).
type JukeboxState struct {
	Queue       []JukeboxEntry `json:"queue"`
	Current     *JukeboxEntry  `json:"current,omitempty"`
	Playing     bool           `json:"playing"`
	PositionSec float64        `json:"positionSec"`
	AnchorMs    int64          `json:"anchorMs"`
	// The room's Spotify Jam invite link (#96) — audio per rider in their own
	// app, never ducked, never synced. Set and cleared like any jukebox action.
	JamURL string `json:"jamUrl,omitempty"`
}

// ServerTick is the coalesced 1 Hz room broadcast: every rider's latest
// sample, the roster, and the shared session state.
type ServerTick struct {
	At      int64        `json:"at"` // unix millis
	State   SessionState `json:"state"`
	Jukebox JukeboxState `json:"jukebox"`
	// This second's cheers, drained each tick like metrics.
	Cheers []Cheer `json:"cheers,omitempty"`
	// This second's chat lines, drained the same way. No backlog on join —
	// ephemeral means ephemeral.
	Chat          []ChatLine          `json:"chat,omitempty"`
	ChatReactions []ChatReactionCount `json:"chatReactions,omitempty"`
	// Sprint moment (#30): armed/live window and, after it closes, the podium.
	Sprint *SprintState `json:"sprint,omitempty"`
	// Running game mode (#31/#32), replacing the workout timeline while on.
	Game *GameState `json:"game,omitempty"`
	// Live execution per rider (#27) — the SPEC score so far this session.
	Execution map[string]float64      `json:"execution,omitempty"`
	Roster    []Rider                 `json:"roster"`
	Riders    map[string]RiderMetrics `json:"riders"`
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
