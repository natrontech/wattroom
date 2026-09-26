package protocol

// IsControlAction reports whether s is one of Control.Action's words — the
// session controls a client may send. The hub checks it before anything else
// in a control frame (#3019): the action is part of that rider's rate-limit
// key, and a string the client chose must not be able to grow the room's map
// of allowances without bound. A new action is added here and to the comment
// on Control.Action together.
func IsControlAction(s string) bool {
	switch s {
	case "pick", "start", "pause", "resume", "end", "handoff",
		"game", "game-end", "sprint", "join", "leave":
		return true
	}
	return false
}
