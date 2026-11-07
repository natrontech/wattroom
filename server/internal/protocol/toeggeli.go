package protocol

// Töggeli is the cozy room's table football (docs/spec/lounge.md): two riders
// in a voice channel play each other, and everyone in it can watch. Paint,
// like the room: the hub runs the match and nothing reaches a ride.

// The ops a ToeggeliCommand carries.
const (
	// Challenge the rider To names.
	ToeggeliChallenge = "challenge"
	// Accept the challenge of the rider To names: the match starts.
	ToeggeliAccept = "accept"
	// Turn a challenge down, or take one back.
	ToeggeliDecline = "decline"
	// Where your rods are, and whether you kick.
	ToeggeliMove = "move"
	// Walk away from the table: the match ends with no winner.
	ToeggeliLeave = "leave"
)

// ToeggeliCommand is a rider's move at the table.
type ToeggeliCommand struct {
	Op string `json:"op"`
	// A rider's id, for a challenge, an accept or a decline.
	To string `json:"to,omitempty"`
	// Where the rods are, 0 at the top of the table to 1 at the bottom.
	Y float64 `json:"y,omitempty"`
	// The button: while it is down the rods' figures kick.
	Kick bool `json:"kick,omitempty"`
}

// The phases of a match.
const (
	ToeggeliPlay = "play"
	// A goal went in: the ball waits at the middle before the kick-off.
	ToeggeliGoal = "goal"
	// The match is over and shows its result before the table clears.
	ToeggeliOver = "over"
	// The table is free again: the last frame of a match, and screens put it away.
	ToeggeliCleared = "cleared"
)

// ToeggeliState is the match at the table, sent to everyone in the channel
// many times a second while it runs. The table runs 0 to 1 along, from the
// left goal to the right, and 0 to 1 across. The left rider defends x = 0.
type ToeggeliState struct {
	Left       string  `json:"left"`
	LeftName   string  `json:"leftName"`
	Right      string  `json:"right"`
	RightName  string  `json:"rightName"`
	LeftGoals  int     `json:"leftGoals"`
	RightGoals int     `json:"rightGoals"`
	BallX      float64 `json:"ballX"`
	BallY      float64 `json:"ballY"`
	LeftY      float64 `json:"leftY"`
	RightY     float64 `json:"rightY"`
	LeftKick   bool    `json:"leftKick,omitempty"`
	RightKick  bool    `json:"rightKick,omitempty"`
	// Milliseconds left on the match's clock.
	LeftMs int64  `json:"leftMs"`
	Phase  string `json:"phase"`
	// Who won, once it is over; "" is a draw or a walk-away.
	Winner string `json:"winner,omitempty"`
	// "" the match ran its course; "left" someone walked away from the table.
	Ended string `json:"ended,omitempty"`
}

// ToeggeliInvite is a challenge, to the rider it names, while it stands.
type ToeggeliInvite struct {
	From     string `json:"from"`
	FromName string `json:"fromName"`
	To       string `json:"to"`
	// Unix millis it lapses at.
	Until int64 `json:"until"`
	// True when it was taken back, turned down or lapsed: the prompt goes.
	Gone bool `json:"gone,omitempty"`
}

// ArcadeToeggeli is Töggeli's board: matches won that day, a rider's best ever
// being their day with the most wins.
const ArcadeToeggeli = "toeggeli"
