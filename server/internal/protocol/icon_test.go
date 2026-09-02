package protocol

import "testing"

func TestIsIconKey(t *testing.T) {
	cases := []struct {
		in string
		ok bool
	}{
		{"flame", true},
		{"biceps-flexed", true},
		{"thumbs-up", true},
		{"a1", true},
		{"", false},
		{"a", false},          // one character is not a name
		{"Flame", false},      // lucide names are lowercase
		{"-flame", false},     // starts with a letter
		{"flame fire", false}, // no spaces
		{"<script>", false},   // no markup
		{"🔥", false},          // an emoji is IsEmoji's job
		{"flame_", false},     // underscores are not lucide's separator
		{"a-very-long-icon-name-that-runs-past-the-cap", false},
	}
	for _, c := range cases {
		if got := IsIconKey(c.in); got != c.ok {
			t.Errorf("IsIconKey(%q) = %v, want %v", c.in, got, c.ok)
		}
	}
}

func TestIsIconOrEmoji(t *testing.T) {
	cases := []struct {
		in string
		ok bool
	}{
		{"flame", true},
		{"🔥", true}, // rooms and clients from before #447
		{"gg!", false},
		{"<script>", false},
		{"", false},
	}
	for _, c := range cases {
		if got := IsIconOrEmoji(c.in); got != c.ok {
			t.Errorf("IsIconOrEmoji(%q) = %v, want %v", c.in, got, c.ok)
		}
	}
}
