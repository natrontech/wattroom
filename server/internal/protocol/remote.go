package protocol

import "unicode/utf8"

// RemoteCommand is one press on a rider's phone remote (#3217), relayed to the
// tab that holds the rider's trainer. It travels both ways in the same shape:
// the phone sends it, the hub forwards it unchanged.
//
// Addressed to that rider's own sockets only and never on the tick, for the
// reason SensorPairing is: what a rider's second screen does is nobody else's
// business.
//
// The view-* actions are the riding screen's view switch, one segment each
// (#4223): 3D, Flat, Map and Room. Flag, TV and End are the now bar's ⚑, TV
// mode (a toggle) and End ride. The phone offers what the bar offers and
// nothing else: one list of the ride's controls, web/src/lib/ride/ride-controls.ts.
//
// Taps never hold: a lost release under Talk's 1 s keepalive measured up to 5
// phantom shifts, so Easier and Harder are one tap each. Only Talk holds, as
// talk-down, a talk-keepalive while it lasts, and talk-up. Sync presses
// nothing: the phone sends it when it opens, and the holder answers with its
// gear and pause state. Skip and Extend are the riding screen's Skip block and
// +1 min (#4425), on a workout whose clock the rider alone owns.
type RemoteCommand struct {
	// One of RemoteActions.
	Action string `json:"action"`
}

// RemoteActions is the closed set behind RemoteCommand.Action. The action is
// part of the sender's rate-limit key, so a word outside the set must not
// reach the room's map of allowances.
var RemoteActions = []string{
	"camera", "photo", "cheer-back",
	"talk-down", "talk-keepalive", "talk-up",
	"easier", "harder", "pause", "resume",
	"view-3d", "view-flat", "view-map", "view-room",
	"sync",
	"skip", "extend",
	"flag", "tv", "end",
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
//
// In ERG the label is what a tap moved instead, the bias or the watts
// (#3334). Idle says no ride runs there to shift: the hub answers the phone
// with remote_conflict in its own words, and the label is empty.
type GearState struct {
	Label string `json:"label"`
	AtEnd bool   `json:"atEnd"`
	Idle  bool   `json:"idle,omitempty"`
}

// MaxGearLabel bounds Label: it is rendered on another screen.
const MaxGearLabel = 16

// PauseState is the holding tab's answer about its ride (#3217): whether it
// is a solo ride the remote may pause, and whether it is paused by the rider.
// It travels the way GearState does. A session is never paused by one rider,
// so a holder in a session says Pausable false.
//
// Blocks and Last answer the same question for Skip and +1 min (#4425): a
// workout whose clock the rider alone owns, and whose blocks end by that
// clock. A road workout's blocks end at their metres (#3499) and a road with
// no workout has none, so both say Blocks false. A session's timeline is the
// coach's, so it says Pausable false and the phone draws neither.
type PauseState struct {
	Pausable bool `json:"pausable"`
	Paused   bool `json:"paused"`
	// Skip block and +1 min act on this ride.
	Blocks bool `json:"blocks,omitempty"`
	// The ride is on its last block: End ride, not Skip.
	Last bool `json:"last,omitempty"`
}

// ViewState is the holding tab's answer about where its rider looks (#4223)
// and which of the now bar's controls it offers. It travels the way GearState
// does, so the phone's view row, Camera, Photo, Flag, TV and End say what the
// riding screen shows and offers now.
type ViewState struct {
	// The view switch's pressed segment: "3d", "flat", "map" or "room".
	Look string `json:"look"`
	// The 3D world draws; false is the flat road.
	World bool `json:"world"`
	// The world's camera ("chase", "heli", "side", "steady"); empty while
	// the road is flat (#4253).
	Camera string `json:"camera,omitempty"`
	// Pictures taken on this ride, so the phone's Photo can say it took one.
	Pictures int `json:"pictures,omitempty"`
	// Flags marked on this ride, so the phone's Flag can say it took one.
	Flags int `json:"flags,omitempty"`
	// TV mode is up on the riding screen.
	TV bool `json:"tv,omitempty"`
	// The remote actions the riding screen offers now: the view segments
	// its switch draws, and Flag, TV and End where its now bar has them.
	Offers []string `json:"offers,omitempty"`
}

// MaxViewPage bounds Look and Camera: each is rendered on another screen.
const MaxViewPage = 8

// Valid reports whether a riding screen's ViewState may be relayed: its words
// short enough to render, its counts not negative, and every offer one of
// RemoteActions, at most once each.
func (v ViewState) Valid() bool {
	if utf8.RuneCountInString(v.Look) > MaxViewPage ||
		utf8.RuneCountInString(v.Camera) > MaxViewPage ||
		v.Pictures < 0 || v.Flags < 0 || len(v.Offers) > len(RemoteActions) {
		return false
	}
	seen := make(map[string]bool, len(v.Offers))
	for _, a := range v.Offers {
		if !IsRemoteAction(a) || seen[a] {
			return false
		}
		seen[a] = true
	}
	return true
}
