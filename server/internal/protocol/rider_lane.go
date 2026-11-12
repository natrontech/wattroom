package protocol

// The rider's own lane on the lobby socket (#4425). The lobby socket is the
// one every signed-in screen holds, whatever page it is on, so it is where a
// ride alone (ADR-0093: the rider's, not a channel's) and the rider's phone
// both reach. It carries the phone remote of a ride that has no voice channel:
// the same RemoteCommand, GearState, PauseState and ViewState a voice channel's
// socket carries for a ride there (#3217).
//
// Every frame on the lane is addressed to the sockets of the rider who sent
// it and to nobody else's, so the lobby's promise holds: nothing on it can
// reach past a channel's gate, because nothing on it reaches another rider.

// LobbyClientMessage is what a screen sends on its lobby socket. Exactly one
// field is set.
type LobbyClientMessage struct {
	// Which ride this screen runs, sent on every open and on every change.
	Ride *RideClaim `json:"ride,omitempty"`
	// A phone remote's press, for the screen running the rider's ride alone.
	Remote *RemoteCommand `json:"remote,omitempty"`
	// The riding screen's answers, for the rider's other screens.
	Gear  *GearState  `json:"gear,omitempty"`
	Pause *PauseState `json:"pause,omitempty"`
	View  *ViewState  `json:"view,omitempty"`
	// The riding screen's game alone: its start, its seconds, its end.
	Game *SoloGameControl `json:"game,omitempty"`
}

// RideClaim is one screen saying whether it runs its rider's ride alone. The
// whole state every time, as SensorClaim is, so a message lost to a reconnect
// cannot leave a ride claimed by a screen that ended it. First claim wins: a
// second screen riding alone never takes the remote off the first.
type RideClaim struct {
	Riding bool `json:"riding"`
	// Which tab this is, as in SensorClaim: a reload keeps its own ride.
	Tab string `json:"tab,omitempty"`
	// The coarse device word, as in SensorClaim.
	Device string `json:"device,omitempty"`
}

// LobbyLane is what the hub sends a screen on the rider's lane. A frame with
// none of these set is a LobbyPing.
type LobbyLane struct {
	// Where the rider's ride alone runs, seen from this screen.
	Ride *RideElsewhere `json:"ride,omitempty"`
	// A phone remote's press, to the riding screen only.
	Remote *RemoteCommand `json:"remote,omitempty"`
	// The riding screen's answers, to the rider's other screens only.
	Gear  *GearState  `json:"gear,omitempty"`
	Pause *PauseState `json:"pause,omitempty"`
	View  *ViewState  `json:"view,omitempty"`
	// The game alone, to the screen riding it only.
	Game *SoloGameFrame `json:"game,omitempty"`
	// Why the phone's last press went nowhere.
	Error *Error `json:"error,omitempty"`
}

// A game alone (#4539): a game picked on a ride alone runs on that ride. The
// rules are the hub's, as in a session (hub/mode_*.go), and the hub judges it
// on the rider's own lane, so nothing of it reaches a crew or another rider.
// The riding screen starts it when its count-in ends, sends one sample a
// second while it rides, and ends it with the ride.

// SoloGameControl is the riding screen's word on its game alone.
type SoloGameControl struct {
	// "start", "sample" or "end".
	Action string `json:"action"`
	// The screen's own name for this game, the same on every frame of it: a
	// reconnect carries on the same game, and a second tab never feeds it.
	ID string `json:"id"`
	// One of the solo modes, on start.
	Mode string `json:"mode,omitempty"`
	// The rider's FTP and weight on start, which the rules score against.
	FtpWatts int `json:"ftpWatts,omitempty"`
	WeightKg int `json:"weightKg,omitempty"`
	// This second's watts, on sample.
	Watts int `json:"watts,omitempty"`
}

// SoloGameFrame is the hub's answer: the game's state, or that the hub has
// no game by that id (a restart, or one let go after its rider went quiet).
type SoloGameFrame struct {
	ID    string     `json:"id"`
	State *GameState `json:"state,omitempty"`
	Gone  bool       `json:"gone,omitempty"`
}

// MaxSoloGameID bounds SoloGameControl.ID: a UUID, with room.
const MaxSoloGameID = 64

// RideElsewhere answers a RideClaim, and every change after it: the device
// word of another of the rider's screens running a ride alone, or "" when
// none does (or this screen is the one riding).
type RideElsewhere struct {
	Device string `json:"device"`
}
