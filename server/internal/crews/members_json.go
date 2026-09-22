package crews

import (
	"math"

	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// What a crew shows about the riding its members did together (#995,
// RESEARCH.md §14.7, ADR-0036 as amended by ADR-0058). Every figure is either
// a whole-crew sum — which orders nobody — or the CALLER's own turnout. No
// other rider's ride-derived number appears.
type togetherJSON struct {
	// Seconds ridden in the crew's sessions by everyone, ever.
	Seconds int64 `json:"seconds"`
	// Sessions this month and last: the crew against its own past (§14.3).
	SessionsThisMonth int64 `json:"sessionsThisMonth"`
	SessionsLastMonth int64 `json:"sessionsLastMonth"`
	// The crew's last sessions, newest first: true where the caller was there.
	Attended []bool `json:"attended"`
}

// riderPrefsJSON is what THIS rider has set for the crew (#1100) — their own
// answers, never anybody else's.
type riderPrefsJSON struct {
	Notify  bool `json:"notify"`
	OnBoard bool `json:"onBoard"`
}

// One rider's week on the crew's board (#995, ADR-0036). Category is a
// bracket rather than a rank — who to compare with — from the FTP and weight
// the crew already shows, not from rides outside it.
type boardRowJSON struct {
	Id          string `json:"id"`
	DisplayName string `json:"displayName"`
	Kj          int64  `json:"kj"`
	Seconds     int64  `json:"seconds"`
	// Absent while both of the pair it is computed from are the account's
	// defaults (ADR-0048, #2243): two guesses divided by each other is a
	// fiction with a decimal point. The row still ranks — kJ is ridden.
	Category string `json:"category,omitempty"`
}

// boardRowOf is one rider's line on the weekly board.
func boardRowOf(row db.CrewWeekBoardRow) boardRowJSON {
	// SPEC defines FTP as 0.95 x the 90-day best 20-minute power, so the
	// bracket reads off the FTP the board already publishes.
	best20m := int(math.Round(float64(row.FtpWatts) / 0.95))
	category := ""
	if chosen(row.FtpSource) || chosen(row.WeightSource) {
		category = stats.Category(best20m, float64(row.WeightKg))
	}
	return boardRowJSON{
		Id: store.UUIDString(row.UserID), DisplayName: row.DisplayName,
		Kj: row.Kj, Seconds: row.Seconds, Category: category,
	}
}

// chosen reports whether somebody answered for this number. ADR-0048 withholds
// w/kg — and the category it brackets — "until at least one of the pair is
// the rider's own". A NULL column is an account from before the provenance.
func chosen(source *string) bool {
	return source != nil && *source != "" && *source != "default"
}
