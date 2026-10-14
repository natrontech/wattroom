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
// talk-down, a talk-keepalive while it lasts, and talk-up.
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
