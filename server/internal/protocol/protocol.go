// Package protocol defines the WebSocket message types. These Go structs are
// the single source of truth; `make protocol` generates the TypeScript types
// via tygo (see WATTROOM.md decisions: WS protocol).
package protocol

// ClientMessage is the envelope for everything a client sends.
type ClientMessage struct {
	Cheer    *Cheer          `json:"cheer,omitempty"`
	Board    *Board          `json:"board,omitempty"`
	Metrics  *RiderMetrics   `json:"metrics,omitempty"`
	Control  *Control        `json:"control,omitempty"`
	Backfill *Backfill       `json:"backfill,omitempty"`
	Jukebox  *JukeboxCommand `json:"jukebox,omitempty"`
	Sensors  *SensorClaim    `json:"sensors,omitempty"`
	Poke     *Poke           `json:"poke,omitempty"`
	Away     *AwayState      `json:"away,omitempty"`
	Device   *DeviceKind     `json:"device,omitempty"`
}

// ServerTick is a voice channel's coalesced 1 Hz broadcast: every rider's
// latest sample, the roster, and the shared session state.
type ServerTick struct {
	At    int64        `json:"at"` // unix millis
	State SessionState `json:"state"`
	// The deck (#286), only on the tick a socket has not heard it on
	// (#2838). It changes with a command and never with the clock — the
	// position is an anchor — so a socket already holding JukeboxRev's deck
	// is not sent it again, the way the workout rides by hash (#1710). A few
	// queued playlists were 85–97 % of every frame. Absent = the deck of
	// JukeboxRev, which the client kept.
	Jukebox    *JukeboxState `json:"jukebox,omitempty"`
	JukeboxRev int64         `json:"jukeboxRev"`
	// This second's cheers, drained each tick like metrics.
	Cheers []Cheer `json:"cheers,omitempty"`
	// This second's soundboard fires, drained the same way. The clip itself
	// is fetched over HTTP — only the trigger rides the tick (ADR-0033).
	Board []Board `json:"board,omitempty"`
	// No chat (#2437, ADR-0058): a voice channel carries none, and a text
	// channel's chat is read over HTTP and re-read on the lobby ping.
	//
	// The recap of the session that just ended (ADR-0034), on the tick where
	// the row lands — the async write's follow-up. Everyone else gets it from the backlog on their next
	// join, because unlike everything above it, this one is durable.
	Recap *SessionRecap `json:"recap,omitempty"`
	// What happened in the channel this second (#321) — the lines the lounge
	// draws beside the deck. Ephemeral, like the cheers above.
	Events []ChannelEvent `json:"events,omitempty"`
	// Sprint moment (#30): armed/live window and, after it closes, the podium.
	Sprint *SprintState `json:"sprint,omitempty"`
	// Running game mode (#31/#32), replacing the workout timeline while on.
	Game *GameState `json:"game,omitempty"`
	// The bunch on the session's road (ADR-0065), while it rides one.
	World *World `json:"world,omitempty"`
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

// Error tells a client why its connection or command was refused.
type Error struct {
	// One of errors.md's closed set — validation_error, invalid_request,
	// unauthorized, forbidden, not_found, conflict, rate_limited,
	// internal_error — optionally prefixed with the surface the refusal
	// belongs to ("jukebox_rate_limited"), so a client can land it beside
	// the control the rider touched instead of in the channel's own refusal
	// slot. The prefix routes; the part after it is always a code from the
	// set.
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ServerMessage is the envelope for everything the server sends.
type ServerMessage struct {
	Tick    *ServerTick    `json:"tick,omitempty"`
	Error   *Error         `json:"error,omitempty"`
	Pairing *SensorPairing `json:"pairing,omitempty"`
	Poke    *Poke          `json:"poke,omitempty"`
	Moved   *Moved         `json:"moved,omitempty"`
	// This socket's own address, sent once on join and to nobody else (#2131).
	Connection *OwnConnection `json:"connection,omitempty"`
}

// LobbyPing is what the lobby socket says (#251): re-fetch. Channel names the
// one text channel whose log changed (#2435, the first step of #2324), so a
// client refetches only the channel it is looking at; absent, or when several
// changes coalesced into one ping, everything is to be re-fetched. An id and
// nothing else — the lines stay behind the channel's own gate — and only to
// riders who may enter the channel (#2821): its activity is gated too.
type LobbyPing struct {
	Channel string `json:"channel,omitempty"`
}
