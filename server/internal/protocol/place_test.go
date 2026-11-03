package protocol

import "testing"

func TestCrewOfPlace(t *testing.T) {
	tests := []struct {
		place, want string
		ok          bool
	}{
		{CrewSessionPlace("c1", "s1"), "c1", true},
		{"6d4f6d1e-0000-4000-8000-000000000000", "", false},
		{"crew:/s1", "", false},
		{"crew:c1", "", false},
	}
	for _, tt := range tests {
		if got, ok := CrewOfPlace(tt.place); got != tt.want || ok != tt.ok {
			t.Errorf("CrewOfPlace(%q) = %q, %v; want %q, %v", tt.place, got, ok, tt.want, tt.ok)
		}
	}
}
