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
		{"", false},
		{"a", false},
		{"<script>", false},
		{"🔥🔥", true}, // two pictographs still can't spell anything
		{"gg🔥", false},
		{"1️⃣", false}, // keycap — known ceiling, see IsEmoji
		{"🔥🔥🔥🔥🔥🔥🔥🔥🔥", false}, // over the rune cap
	}
	for _, c := range cases {
		if got := IsEmoji(c.in); got != c.ok {
			t.Errorf("IsEmoji(%q) = %v, want %v", c.in, got, c.ok)
		}
	}
}
