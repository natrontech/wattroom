package protocol

import "testing"

func TestIsEmoji(t *testing.T) {
	cases := []struct {
		in string
		ok bool
	}{
		{"🔥", true},
		{"💪", true},
		{"🧊", true},
		{"⚡", true},       // 0x26A1, misc symbols
		{"👍🏽", true},      // skin tone modifier
		{"👨‍👩‍👧‍👦", true}, // ZWJ family
		{"🏳️‍🌈", true},    // flag + VS16 + ZWJ
		{"🏴󠁧󠁢󠁥󠁮󠁧󠁿", true}, // tag sequence: 7 runes, 28 bytes — the picker's longest
		{"", false},
		{"a", false},
		{"<script>", false},
		{"🔥🔥", true}, // two pictographs still can't spell anything
		{"gg🔥", false},
		{"🔥🔥🔥🔥🔥🔥🔥🔥🔥", false}, // over the rune cap

		// The BMP stragglers below the ranges (#2643), as the picker sends
		// them — with VS16 — and bare, which renders as the same symbol.
		{"‼️", true},
		{"⁉️", true},
		{"〰️", true},
		{"〽️", true},
		{"©️", true},
		{"®️", true},
		{"™️", true},
		{"ℹ️", true},
		{"㊗️", true},
		{"㊙️", true},
		{"™", true},
		{"©®", true},

		// Keycaps: an ASCII base, VS16, the keycap mark.
		{"#️⃣", true},
		{"*️⃣", true},
		{"0️⃣", true},
		{"1️⃣", true},
		{"2️⃣", true},
		{"3️⃣", true},
		{"4️⃣", true},
		{"5️⃣", true},
		{"6️⃣", true},
		{"7️⃣", true},
		{"8️⃣", true},
		{"9️⃣", true},
		{"1⃣", true}, // without VS16, still a keycap

		// The base alone is text, and a keycap does not launder text in
		// front of it.
		{"1", false},
		{"#", false},
		{"*", false},
		{"12️⃣", false},
		{"1️", false},
		{"a️⃣", false}, // not a keycap base
		{"hi", false},
		{"hi™", false},
	}
	for _, c := range cases {
		if got := IsEmoji(c.in); got != c.ok {
			t.Errorf("IsEmoji(%q) = %v, want %v", c.in, got, c.ok)
		}
	}
}

func TestIsCustomEmoji(t *testing.T) {
	cases := []struct {
		in string
		ok bool
	}{
		{":party_parrot:", true},
		{":gg:", true},
		{":v2:", true},
		{":" + "abcdefghijklmnopqrstuvwxyz012345" + ":", true}, // 32, the cap
		{":" + "abcdefghijklmnopqrstuvwxyz0123456" + ":", false},
		{":a:", false},  // one character is not a name
		{"::", false},   // nor is none
		{"gg", false},   // a name, not a key
		{":gg", false},  // unclosed
		{"gg:", false},  // unopened
		{":GG:", false}, // lowercase only
		{":g-g:", false},
		{":g g:", false},
		{":gg::gg:", false},
		{":🔥:", false},
	}
	for _, c := range cases {
		if got := IsCustomEmoji(c.in); got != c.ok {
			t.Errorf("IsCustomEmoji(%q) = %v, want %v", c.in, got, c.ok)
		}
	}
	for name, ok := range map[string]bool{"gg": true, "party_parrot": true, ":gg:": false, "g": false, "Gg": false} {
		if got := IsCustomEmojiName(name); got != ok {
			t.Errorf("IsCustomEmojiName(%q) = %v, want %v", name, got, ok)
		}
	}
}

func TestIsReaction(t *testing.T) {
	cases := []struct {
		in string
		ok bool
	}{
		{"flame", true},       // an icon key (#447)
		{"🔥", true},           // an emoji
		{"1️⃣", true},         // a keycap (#2643)
		{":gg:", true},        // a crew's own emoji (#2643)
		{"gg!", false},        // text
		{"<script>", false},   // markup
		{":<script>:", false}, // markup between colons is still markup
		{"", false},
	}
	for _, c := range cases {
		if got := IsReaction(c.in); got != c.ok {
			t.Errorf("IsReaction(%q) = %v, want %v", c.in, got, c.ok)
		}
	}
}
