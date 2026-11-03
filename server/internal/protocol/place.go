package protocol

import "strings"

// CrewSessionPlace is where a crew's own session lives (docs/SESSIONS.md):
// the key the hub holds its room under, and the "channel" the saver, the
// recap and the roads read its crew from.
// ponytail: a string in the channel's slot, until the contract PR gives a
// session a room type of its own.
func CrewSessionPlace(crew, session string) string { return "crew:" + crew + "/" + session }

// CrewOfPlace is the crew a crew session's place names; false for a voice
// channel's id.
func CrewOfPlace(place string) (crew string, ok bool) {
	rest, ok := strings.CutPrefix(place, "crew:")
	if !ok {
		return "", false
	}
	crew, _, ok = strings.Cut(rest, "/")
	if !ok || crew == "" {
		return "", false
	}
	return crew, true
}
