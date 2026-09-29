package protocol

import "testing"

func TestIsControlAction(t *testing.T) {
	for _, tc := range []struct {
		action string
		want   bool
	}{
		{"pick", true},
		{"start", true},
		{"pause", true},
		{"resume", true},
		{"end", true},
		{"handoff", true},
		{"game", true},
		{"game-end", true},
		{"sprint", true},
		{"join", true},
		{"leave", true},
		{"", false},
		{"Pick", false},
		{"pick ", false},
		{"stop", false},
		{"pick:start", false},
	} {
		if got := IsControlAction(tc.action); got != tc.want {
			t.Errorf("IsControlAction(%q) = %v, want %v", tc.action, got, tc.want)
		}
	}
}
