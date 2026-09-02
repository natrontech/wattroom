package protocol

import "regexp"

// iconKey is the shape of a lucide icon name (#447): lowercase, digits and
// hyphens, 2–32 characters. The server checks the shape, not the vocabulary —
// which icons a room may wear is the client's curated set, and a key the
// client does not know draws as a placeholder rather than failing the save.
var iconKey = regexp.MustCompile(`^[a-z][a-z0-9-]{1,31}$`)

// IsIconKey reports whether s is shaped like an icon key.
func IsIconKey(s string) bool {
	return iconKey.MatchString(s)
}

// IsIconOrEmoji is what a room icon, a cheer or a chat reaction may be on the
// wire and in the store: an icon key (#447) — or one emoji, still accepted so
// rooms saved and clients built before #447 keep working. The client draws a
// known emoji as its icon.
func IsIconOrEmoji(s string) bool {
	return IsIconKey(s) || IsEmoji(s)
}
