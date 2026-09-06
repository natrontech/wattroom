package notify

import (
	"testing"
	"time"
)

func TestLocalTime(t *testing.T) {
	// 17:00 UTC is 19:00 in Zurich and 13:00 in New York.
	at := time.Date(2026, 9, 8, 17, 0, 0, 0, time.UTC)
	zurich, newYork, junk, empty := "Europe/Zurich", "America/New_York", "Nowhere/Atlantis", ""

	for _, tc := range []struct {
		name string
		zone *string
		want string
	}{
		{"the rider's zone", &zurich, "Tue 8 Sep, 19:00"},
		{"a different rider's zone", &newYork, "Tue 8 Sep, 13:00"},
		// Every case below falls back to the server's zone, which is what all
		// of this did before the column existed — so the fallback makes
		// nothing worse than it already was.
		{"never reported", nil, at.Local().Format(timeLayout)},
		{"reported empty", &empty, at.Local().Format(timeLayout)},
		{"a name IANA has since retired", &junk, at.Local().Format(timeLayout)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := localTime(at, tc.zone); got != tc.want {
				t.Fatalf("localTime = %q, want %q", got, tc.want)
			}
		})
	}
}
