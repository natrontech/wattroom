package textx

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestClipKeepsRunesWhole(t *testing.T) {
	cases := []struct {
		name, in string
		n        int
		want     string
	}{
		{"short stays", "abc", 5, "abc"},
		{"ascii cut", "abcdef", 3, "abc"},
		{"cjk cut at a rune", "音楽室の机", 4, "音楽室の"},
		// The production case (#2681): 200 runes of hangul is 600 bytes.
		{"past 200 bytes, within 200 runes", strings.Repeat("ㅋ", 200), 200, strings.Repeat("ㅋ", 200)},
	}
	for _, c := range cases {
		got := Clip(c.in, c.n)
		if got != c.want || !utf8.ValidString(got) {
			t.Errorf("%s: Clip = %q (valid=%v), want %q", c.name, got, utf8.ValidString(got), c.want)
		}
	}
}
