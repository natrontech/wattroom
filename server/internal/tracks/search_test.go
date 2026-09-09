package tracks

import "testing"

func TestSearchQueryPrefixesEveryWord(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"", ""},
		{"   ", ""},
		{"sun", "sun:*"},
		{"Sunrise Pa", "sunrise:* & pa:*"},
		{"rock & roll (live)", "rock:* & roll:* & live:*"},
		{"!!!", ""},
		{"Über 90", "über:* & 90:*"},
	} {
		if got := searchQuery(tc.in); got != tc.want {
			t.Errorf("searchQuery(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
