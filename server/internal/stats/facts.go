package stats

import "time"

// Zone edges the ride achievements judge against (docs/SPEC.md, defaults —
// tune in alpha): "above threshold" starts at FTP, Z6 at 121 % of it, and
// "above sweet spot" is anything past the sweet spot's 94 % ceiling.
const (
	thresholdPct = 1.00
	z6Pct        = 1.21
	sweetSpotTop = 0.94
)

// RideFacts is what one saved ride tells the trophy case (#467): its clock
// times and zone seconds, counted from the samples in hand at save time.
// Rides store no zone seconds, so this is the only moment they exist.
type RideFacts struct {
	StartedAt time.Time
	Seconds   int
	// Seconds at or above FTP.
	AboveFtpSec int
	// Seconds in Z6 or above.
	Z6Sec int
	// Seconds above the sweet spot ceiling.
	AboveSweetSpotSec int
}

// Facts counts a ride's zone seconds against the FTP it was ridden at. No
// FTP means no zones: the ride still counts, its intensity does not.
func Facts(startedAt time.Time, ftp int, watts []int) RideFacts {
	f := RideFacts{StartedAt: startedAt, Seconds: len(watts)}
	if ftp <= 0 {
		return f
	}
	for _, w := range watts {
		pct := float64(w) / float64(ftp)
		if pct >= thresholdPct {
			f.AboveFtpSec++
		}
		if pct >= z6Pct {
			f.Z6Sec++
		}
		if pct > sweetSpotTop {
			f.AboveSweetSpotSec++
		}
	}
	return f
}
