package av

import "testing"

func TestRiderID(t *testing.T) {
	for _, tc := range []struct {
		name     string
		identity string
		want     string
	}{
		{"per-connection identity", "jan-id#a1b2c3", "jan-id"},
		{"another tab of the same rider", "jan-id#ffffff", "jan-id"},
		{"nonce-less identity is its own rider", "jan-id", "jan-id"},
		{"empty stays empty", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := RiderID(tc.identity); got != tc.want {
				t.Fatalf("RiderID(%q) = %q, want %q", tc.identity, got, tc.want)
			}
		})
	}
}

// Two tabs of one rider must never collide, or LiveKit evicts one of them and
// they trade the slot forever (#293).
func TestIdentitiesAreUniquePerConnection(t *testing.T) {
	seen := make(map[string]bool, 64)
	for range 64 {
		id, err := newIdentity("jan-id")
		if err != nil {
			t.Fatal(err)
		}
		if RiderID(id) != "jan-id" {
			t.Fatalf("identity %q lost its rider", id)
		}
		if seen[id] {
			t.Fatalf("identity %q minted twice", id)
		}
		seen[id] = true
	}
}
