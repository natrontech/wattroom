package protocol

// RemoteCommand is one press on a rider's phone remote (#3217), relayed to the
// tab that holds the rider's trainer. It travels both ways in the same shape:
// the phone sends it, the hub forwards it unchanged.
//
// Addressed to that rider's own sockets only and never on the tick, for the
// reason SensorPairing is: what a rider's second screen does is nobody else's
// business.
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
