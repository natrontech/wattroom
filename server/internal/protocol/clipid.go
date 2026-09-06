package protocol

// IsClipID shape-checks a soundboard clip id before it goes on the tick
// (#877). The hub never resolves it — the audio endpoint does — so this is
// only here to keep an unbounded or ill-formed string out of every client's
// payload.
func IsClipID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range []byte(s) {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			isHex := c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F'
			if !isHex {
				return false
			}
		}
	}
	return true
}
