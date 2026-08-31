package protocol

import "unicode/utf8"

// IsEmoji reports whether s is one emoji grapheme (a pictograph, possibly a
// ZWJ sequence like 👨‍👩‍👧‍👦). It is the wire's guarantee that a cheer or chat
// reaction can't smuggle text — which room emoji are welcome is the owner's
// palette (#223), enforced client-side.
// ponytail: rune-range heuristic, not UTS-51 — keycaps (1️⃣) and ©™ are
// refused; swap in a real segmenter if anyone ever misses them.
func IsEmoji(s string) bool {
	if s == "" || len(s) > 28 || utf8.RuneCountInString(s) > 8 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 0x1F000: // pictographs, flags, skin tones
		case r >= 0x2190 && r <= 0x2BFF: // arrows, misc symbols, dingbats
		case r == 0x200D || r == 0xFE0F: // ZWJ, variation selector
		default:
			return false
		}
	}
	return true
}
