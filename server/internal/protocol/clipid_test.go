package protocol

import "testing"

func TestIsClipID(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"3f2504e0-4f89-11d3-9a0c-0305e82c3301", true},
		{"3F2504E0-4F89-11D3-9A0C-0305E82C3301", true},
		{"", false},
		{"3f2504e0-4f89-11d3-9a0c-0305e82c330", false},   // one short
		{"3f2504e0-4f89-11d3-9a0c-0305e82c33011", false}, // one long
		{"3f2504e04f8911d39a0c0305e82c3301xxxx", false},  // right length, no dashes
		{"3f2504e0-4f89-11d3-9a0c-0305e82c330g", false},  // not hex
		{"../../../etc/passwd/aaaaaaaaaaaaaaaaa", false},
	}
	for _, tt := range tests {
		if got := IsClipID(tt.in); got != tt.want {
			t.Errorf("IsClipID(%q) = %v; want %v", tt.in, got, tt.want)
		}
	}
}
