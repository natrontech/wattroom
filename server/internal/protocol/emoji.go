package protocol

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// IsEmoji reports whether s is one emoji grapheme (a pictograph, possibly a
// ZWJ sequence like 👨‍👩‍👧‍👦). It is the wire's guarantee that a cheer or chat
// reaction can't smuggle text — which emoji are welcome is the crew's
// palette (#223), enforced client-side.
// ponytail: rune-range heuristic, not UTS-51 — the ranges plus the ten BMP
// stragglers and the keycaps below cover every emoji the client's picker
// offers (emojibase-data v17, #2643); swap in a real segmenter if one misses.
func IsEmoji(s string) bool {
	if s == "" || len(s) > 28 || utf8.RuneCountInString(s) > 8 {
		return false
	}
	for i, r := range s {
		switch {
		case r >= 0x1F000: // pictographs, flags, skin tones, tag sequences
		case r >= 0x2190 && r <= 0x2BFF: // arrows, misc symbols, dingbats
		case r == 0x200D || r == 0xFE0F || r == 0x20E3: // ZWJ, variation selector, keycap
		case bmpEmoji[r]:
		// A keycap's base is ASCII, so it is an emoji only with the keycap
		// mark right behind it — "1" and "#" alone stay text, and so does
		// "123" in front of one.
		case keycapBase(r) && (strings.HasPrefix(s[i+1:], "⃣") || strings.HasPrefix(s[i+1:], "️⃣")):
		default:
			return false
		}
	}
	return true
}

// bmpEmoji is the emoji below the ranges IsEmoji walks: © ® ‼ ⁉ ™ ℹ 〰 〽 ㊗ ㊙.
var bmpEmoji = map[rune]bool{
	0x00A9: true, 0x00AE: true, 0x203C: true, 0x2049: true, 0x2122: true,
	0x2139: true, 0x3030: true, 0x303D: true, 0x3297: true, 0x3299: true,
}

func keycapBase(r rune) bool { return r == '#' || r == '*' || (r >= '0' && r <= '9') }

// customEmojiName is the shape of a crew's own emoji name (#2643): an alphabet
// with no colon and no space in it, so `:name:` inside a chat line reads one
// way. The crew_emoji CHECK holds the same bounds as a literal.
var customEmojiName = regexp.MustCompile(fmt.Sprintf(`^[a-z0-9_]{%d,%d}$`, MinEmojiNameChars, MaxEmojiNameChars))

// IsCustomEmojiName reports whether s is shaped like a crew emoji's name.
func IsCustomEmojiName(s string) bool {
	return customEmojiName.MatchString(s)
}

// IsCustomEmoji reports whether s is a crew emoji's reaction key: its name
// between two colons.
func IsCustomEmoji(s string) bool {
	name, ok := strings.CutPrefix(s, ":")
	if !ok {
		return false
	}
	name, ok = strings.CutSuffix(name, ":")
	return ok && IsCustomEmojiName(name)
}

// IsReaction is what a cheer or a reaction may be on the wire and in the
// store: IsIconOrEmoji, or a crew's own emoji by key (#2643). The shape, not
// the vocabulary — a key whose emoji the crew has since deleted draws as its
// `:name:` text, the way an unknown icon key draws as a placeholder.
func IsReaction(s string) bool {
	return IsIconOrEmoji(s) || IsCustomEmoji(s)
}
