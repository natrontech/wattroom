package protocol

// RemoteCommand is one press on a rider's phone remote (#3217), relayed to the
// tab that holds the rider's trainer. It travels both ways in the same shape:
// the phone sends it, the hub forwards it unchanged.
//
// Addressed to that rider's own sockets only and never on the tick, for the
// reason SensorPairing is: what a rider's second screen does is nobody else's
// business.
//
// View flips the riding screen between the 3D world and the flat road
// (#4223); Page turns the bike computer to its next page, and Map to MAP and
// back.
//
// Taps never hold: a lost release under Talk's 1 s keepalive measured up to 5
// phantom shifts, so Easier and Harder are one tap each. Only Talk holds, as
// talk-down, a talk-keepalive while it lasts, and talk-up. Sync presses
// nothing: the phone sends it when it opens, and the holder answers with its
// gear and pause state.
type RemoteCommand struct {
	// One of RemoteActions.
	Action string `json:"action"`
}

// RemoteActions is the closed set behind RemoteCommand.Action. The action is
// part of the sender's rate-limit key, so a word outside the set must not
// reach the room's map of allowances.
var RemoteActions = []string{
	"page", "camera", "photo", "cheer-back", "map",
	"talk-down", "talk-keepalive", "talk-up",
	"easier", "harder", "pause", "resume",
	"view",
	"sync",
}

// IsRemoteAction reports whether s is one of RemoteActions.
func IsRemoteAction(s string) bool {
	for _, a := range RemoteActions {
		if a == s {
			return true
		}
	}
	return false
}

// GearState is the holding tab's answer to a phone remote (#3217): the gear it
// is in and whether the next press would hit an end. It travels the way
// RemoteCommand does, to the same rider's other screens only, so the phone's
// Easier and Harder can say where they are without a screen to look at.
type GearState struct {
	Label string `json:"label"`
	AtEnd bool   `json:"atEnd"`
}

// MaxGearLabel bounds Label: it is rendered on another screen.
const MaxGearLabel = 16

// PauseState is the holding tab's answer about its ride (#3217): whether it
// is a solo ride the remote may pause, and whether it is paused by the rider.
// It travels the way GearState does. A session is never paused by one rider,
// so a holder in a session says Pausable false.
type PauseState struct {
	Pausable bool `json:"pausable"`
	Paused   bool `json:"paused"`
}

// ViewState is the holding tab's answer about where its rider looks (#4223):
// the bike computer's page and whether the 3D world draws. It travels the way
// GearState does, so the phone's Page, Map and 3D / Flat say what the riding
// screen shows now.
type ViewState struct {
	// The bike computer's page, as its id ("ride", "map" …); empty where
	// the screen has no computer.
	Page string `json:"page"`
	// The 3D world draws; false is the flat road.
	World bool `json:"world"`
	// The world's camera ("chase", "heli", "side", "steady"); empty while
	// the road is flat (#4253).
	Camera string `json:"camera,omitempty"`
	// Pictures taken on this ride, so the phone's Photo can say it took one.
	Pictures int `json:"pictures,omitempty"`
}

// MaxViewPage bounds Page and Camera: each is rendered on another screen.
const MaxViewPage = 8
