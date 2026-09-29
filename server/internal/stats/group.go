package stats

// A group session (docs/SPEC.md XP sources, defaults — tune in alpha): one
// with at least two saved rides and ten minutes of timeline. The session
// voice bonus pays in one and the wallet's × 1.2 (#3152) mints in one, so
// the rule lives once, here.
const (
	groupSessionRiders = 2
	groupSessionMinSec = 10 * 60
)

// GroupSession reports whether a session of `rides` saved rides and
// `seconds` of timeline is a group session.
func GroupSession(rides, seconds int) bool {
	return rides >= groupSessionRiders && seconds >= groupSessionMinSec
}
