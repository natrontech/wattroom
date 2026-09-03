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
	Action  string `json:"action"` // "add" | "remove" | "vote" | "move" | "play" | "pause" | "skip" | "back" | "skipPlaylist" | "seek" | "ended"
	VideoID string `json:"videoId,omitempty"`
	Title   string `json:"title,omitempty"`
	// For "add": queue a whole YouTube playlist as one entry (#615). The
	// client resolves the tracks — the server still knows nothing about
	// YouTube, it just holds the list the paste produced.
	PlaylistID    string         `json:"playlistId,omitempty"`
	PlaylistTitle string         `json:"playlistTitle,omitempty"`
	Tracks        []JukeboxTrack `json:"tracks,omitempty"`
	// For "remove" | "vote" | "move": which queue entry (#286). Video ids
	// are not unique — the same track queued twice is two entries, and
	// addressing by video used to hit the wrong one.
	EntryID string `json:"entryId,omitempty"`
	// For "move": the entry's new index in the queue, clamped to it.
	Index int `json:"index,omitempty"`
	// For "seek": the new shared playhead. For "add": start the entry here
	// (a pasted ?t= timestamp) — 0 means the beginning, like any URL.
	PositionSec float64 `json:"positionSec,omitempty"`
	// For "ended": the anchor the client was playing against. Every client
	// (and tab) reports the end — the epoch match makes N echoes advance
	// the queue exactly once even when the same video is queued twice.
	AnchorMs int64 `json:"anchorMs,omitempty"`
}

// ChatLine is one ephemeral room message (#146, ADR-0010): room-scoped,
// never persisted — it rides the tick like cheers and dies with the page.
// Warm-up and phone talk; mid-effort stays the cheers' job.
type ChatLine struct {
	// Persisted identity (ADR-0010 amended, #201) — what reactions attach to.
	// Empty when the server runs without a database.
	ID   string `json:"id,omitempty"`
	From string `json:"from"` // filled by the server, like cheers
	// The author's rider id (#219): display names are not unique, and the
	// client's own-message suppression must not mute a namesake.
	FromID string `json:"fromId,omitempty"`
	Text   string `json:"text"`
	// A pasted image (#279): id of a room-scoped blob the client uploaded via
	// POST /api/rooms/{slug}/chat/images before sending; rendered from the
	// matching GET. A line may be image-only (empty text).
	ImageID string `json:"imageId,omitempty"`
	At      int64  `json:"at"` // server millis, for ordering only
}

// ChatID attaches the persisted identity to a line broadcast on an earlier
// tick (#219): the save runs off the read loop, so the id follows the line.
// FromID+At name the line — the 1/s per-rider chat limit makes the pair unique.
type ChatID struct {
	FromID string `json:"fromId"`
	At     int64  `json:"at"`
	ID     string `json:"id"`
}

// ChatReact toggles one rider's emoji on one message (#201) — the cheer
// vocabulary, attached instead of thrown.
type ChatReact struct {
	MessageID string `json:"messageId"`
	Emoji     string `json:"emoji"`
}

// ChatReactionCount is a changed total, broadcast on the tick — plus who
// changed it and which way (#219): the actor's own tabs reconcile their
// "did I react" highlight from the server instead of trusting the click.
type ChatReactionCount struct {
	MessageID string `json:"messageId"`
	Emoji     string `json:"emoji"`
	Count     int    `json:"count"`
	By        string `json:"by,omitempty"` // rider id of the toggler
	Added     bool   `json:"added"`
}

// RoomEvent is something the ROOM did, next to what riders said (#321): the
// jukebox changing under everyone is half of what happened here, and thirty
// seconds later "who put this on?" has no other answer. Structured, not a
// sentence — the client owns the wording, so the chat pane and the dock name
// a track identically.
//
// Ephemeral by design (ADR-0019): it rides the tick like cheers and is never
// written to the chat table. A month of "now playing" in the backlog is noise.
type RoomEvent struct {
	// Room-unique and stable across re-broadcasts: a growing burst re-sends
	// the SAME id with a higher Count, and clients replace the line in place.
	ID   string `json:"id"`
	Kind string `json:"kind"` // "jukebox" | "session"
	// jukebox: "queued" | "removed" | "skipped" | "playing"
	// session: "planned" | "moved" | "cancelled" | "started" | "ended"
	Verb string `json:"verb"`
	// Who did it. Empty when nobody did — the deck advancing on its own, or
	// a session the clock started.
	Actor string `json:"actor,omitempty"`
	// The title the dock shows, so both surfaces name the same track. Empty
	// on a coalesced burst, which has no single title left to show.
	Track string `json:"track,omitempty"`
	// The workout a session line is about.
	Subject string `json:"subject,omitempty"`
	// When that session is planned for, server millis. 0 on a line with no
	// time of its own ("started", "ended").
	When int64 `json:"when,omitempty"`
	// For "playing": who put this track in the queue.
	QueuedBy string `json:"queuedBy,omitempty"`
	// How many tracks this one line covers — 1 normally, more when a burst
	// of adds coalesced ("queued 8 tracks"). Eight lines would push the
	// actual conversation off the screen.
	Count int   `json:"count"`
	At    int64 `json:"at"` // server millis, for ordering only
}

// Cheer is the room's reaction layer (#74) — and the spectator's one verb.
type Cheer struct {
	Emoji string `json:"emoji"`
	// Sender name, filled by the server: cheering is presence.
	From string `json:"from,omitempty"`
}

// SensorClaim is one socket telling the hub which sensors it has connected
// (#610).
//
// A Web Bluetooth grant cannot leave the browser that made it, so pairing
// itself stays client-owned (ARCHITECTURE seam 1). What the hub owns is which
// of a rider's sockets holds each kind — so the rider's other tabs and devices
// stop offering to pair a second one, and so only one of them feeds the ride
// record.
type SensorClaim struct {
	// Kinds this socket holds: "trainer", "heart-rate", "power-meter" or
	// "cadence". Always the socket's WHOLE current set, never a delta — a
	// message lost to a reconnect can then never leave a claim stuck behind.
	Held []string `json:"held"`
	// Which tab this is, so a reload reclaims what it already had instead of
	// locking itself out behind its own not-yet-reaped socket. Client-minted
	// and per-tab (sessionStorage); the hub treats it as an opaque label and
	// scopes it to the rider, so it can only ever address that rider's own
	// claims.
	Tab string `json:"tab,omitempty"`
	// A coarse word for the rider's OTHER screens to render: "phone",
	// "tablet" or "desktop". Never leaves the rider's own sockets.
	Device string `json:"device,omitempty"`
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
	Sensors   *SensorClaim    `json:"sensors,omitempty"`
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

// JukeboxTrack is one video inside a queued playlist (#615). Ids and titles
// both ride the wire: the client resolves them once when the playlist is
// pasted, and the server needs the title for the now-playing timeline line.
type JukeboxTrack struct {
	VideoID string `json:"videoId"`
	Title   string `json:"title"`
}

type JukeboxEntry struct {
	// Room-unique, server-assigned: what remove/vote/move address (#286).
	ID string `json:"id"`
	// What is on the deck RIGHT NOW. For a playlist entry (#615) this is
	// Tracks[Index] and changes as the entry plays through — which is why
	// the whole client playback path needed no playlist branch of its own.
	VideoID string `json:"videoId"`
	Title   string `json:"title"`
	AddedBy string `json:"addedBy"`
	// Where playback begins when this entry reaches the deck (?t= paste).
	StartSec float64 `json:"startSec,omitempty"`
	// Upvotes float an entry above lower-voted ones (#286). The voters are
	// rider ids, not a count — room-scoped like every other live field, and
	// the only way a client renders "you voted" from truth, not from its
	// own click. The count is len(voters); nothing to keep in sync.
	Voters []string `json:"voters,omitempty"`
	// Set when the entry is a whole YouTube playlist queued as one thing
	// (#615) — a playlist takes ONE queue slot, so a paste cannot own the
	// room's 50 and the vote order keeps meaning something.
	PlaylistID    string `json:"playlistId,omitempty"`
	PlaylistTitle string `json:"playlistTitle,omitempty"`
	// The playlist in order, resolved by the client that pasted it. Empty
	// for a single video: len(Tracks) > 0 is what makes an entry a playlist.
	Tracks []JukeboxTrack `json:"tracks,omitempty"`
	// Which track is on the deck. Only ever moves within [0, len(Tracks)):
	// running off the end advances to the next QUEUE entry rather than
	// wrapping — a playlist plays once through and never restarts itself.
	Index int `json:"index,omitempty"`
}

// JukeboxState is the server's truth about what plays where. Clients chase the
// anchor: position = PositionSec, plus SERVER time since AnchorMs while
// playing — a client's own wall clock is skewed by seconds and applying it
// here is what made the jukebox "not synced" (#286). Clients estimate the
// offset from ServerTick.At and translate.
// The audio itself is local per rider — their iframe, their volume — and never
// enters the voice path (SPEC room audio defaults).
type JukeboxState struct {
	Queue       []JukeboxEntry `json:"queue"`
	Current     *JukeboxEntry  `json:"current,omitempty"`
	Playing     bool           `json:"playing"`
	PositionSec float64        `json:"positionSec"`
	AnchorMs    int64          `json:"anchorMs"`
	// What the room just played, newest first (#286) — the deck's short
	// memory, so "put that on again" is one tap and nobody retypes a link.
	History []JukeboxEntry `json:"history"`
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
	// Persisted ids for lines already broadcast (#219) — the async save's
	// follow-up, unlocking reactions on them.
	ChatIDs []ChatID `json:"chatIds,omitempty"`
	// What the room did this second (#321) — jukebox actions the chat pane
	// interleaves with the talking. Ephemeral, like the cheers above.
	Events []RoomEvent `json:"events,omitempty"`
	// Sprint moment (#30): armed/live window and, after it closes, the podium.
	Sprint *SprintState `json:"sprint,omitempty"`
	// Running game mode (#31/#32), replacing the workout timeline while on.
	Game *GameState `json:"game,omitempty"`
	// Live execution per rider (#27) — the SPEC score so far this session.
	Execution map[string]float64 `json:"execution,omitempty"`
	// Who the LiveKit webhooks say is in voice (#467), by rider id. A client
	// learns this from LiveKit only once it has joined itself, so without the
	// server's answer an empty voice roster is indistinguishable from a full
	// one you have not entered yet.
	Voice  []string                `json:"voice,omitempty"`
	Roster []Rider                 `json:"roster"`
	Riders map[string]RiderMetrics `json:"riders"`
}

// RoomPresence is the hub's live answer for one room (#251): the rooms list,
// the rail, and the /rooms page all render this shape. It rides GET /api/rooms
// rather than the room WS, but it is shared vocabulary like Rider — one
// canonical home, generated for the client like everything here.
type RoomPresence struct {
	// Riders connected to the room WS, counted as people, not sockets.
	Connected int    `json:"connected,omitempty"`
	Phase     string `json:"phase,omitempty"`
	// Display names — members-only server-side, room-scoped like all live data.
	Riders []string `json:"riders,omitempty"`
	// Who is in the voice channel, and who has a camera live (LiveKit webhooks).
	Voice   []string `json:"voice,omitempty"`
	Cameras []string `json:"cameras,omitempty"`
	// Names with live metrics in the last few seconds — the watt dot.
	Riding []string `json:"riding,omitempty"`
	// The late-join radar: what is on and how far in, while a session runs.
	WorkoutName string `json:"workoutName,omitempty"`
	ElapsedSec  int    `json:"elapsedSec,omitempty"`
}

// Error tells a client why its connection or command was refused.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// SensorPairing is the hub's answer to a SensorClaim: what this socket ended
// up holding, and what one of the rider's other screens is already holding.
//
// It goes ONLY to the sockets of the rider it describes, and deliberately not
// on the tick: what a rider straps on is nobody else's business (privacy is
// architecture, WATTROOM.md), and the tick stays one message per room per
// second (ARCHITECTURE seam 2) for state that changes every second — this
// changes only when somebody pairs or unpairs.
type SensorPairing struct {
	// Kinds this socket holds, as GRANTED — the claim minus anything another
	// of the rider's screens got to first.
	Held []string `json:"held,omitempty"`
	// Kind -> the device word of the rider's other screen holding it. What
	// the sensor cards render instead of a pair button.
	Elsewhere map[string]string `json:"elsewhere,omitempty"`
}

// ServerMessage is the envelope for everything the server sends.
type ServerMessage struct {
	Tick    *ServerTick    `json:"tick,omitempty"`
	Error   *Error         `json:"error,omitempty"`
	Pairing *SensorPairing `json:"pairing,omitempty"`
}
