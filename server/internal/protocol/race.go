package protocol

import (
	"math"
	"time"
)

// Races (docs/SPEC.md "Races", ADR-0067): a weight changed within the freeze
// before the flag rides unranked, and so does one the rider has not confirmed
// within the confirmation window.
const (
	RaceWeightFreezeDays  = 14
	RaceWeightConfirmDays = 90
)

// A race's start and its field (docs/SPEC.md "Races" — defaults, tune in
// alpha): the neutral zone ridden at 0 % between the countdown and the km-0
// klaxon, the riders a race needs to start, and how long a silent rider keeps
// their place before they are out of it.
const (
	RaceNeutralSeconds    = 3 * 60
	RaceMinRiders         = 2
	RaceDisconnectSeconds = 30
)

// Why a race rides a rider unranked (ADR-0067). They still race; this is what
// the closing card tells them kept them off the results.
const (
	UnrankedDefaultFtp        = "default_ftp"
	UnrankedDefaultWeight     = "default_weight"
	UnrankedFreshWeight       = "fresh_weight"
	UnrankedUnconfirmedWeight = "unconfirmed_weight"
	// "Don't make me shift": WattRoom chose the watts, so the ride is
	// untimeable and the race cannot place it (ADR-0084, ADR-0074).
	UnrankedUntimeable = "untimeable"
)

// Unranked is why a race whose flag drops at flag cannot place r, or "" when
// it can. A race reads it once, at the flag, beside the FTP and weight it
// freezes there — the race FTP being SuggestFTP's number when it makes
// one — so a profile saved mid-race moves the roster and never the result.
func Unranked(r Rider, flag time.Time) string {
	within := func(ms int64, days int) bool {
		return flag.Sub(time.UnixMilli(ms)) < time.Duration(days)*24*time.Hour
	}
	switch {
	case !answered(r.FtpSource):
		return UnrankedDefaultFtp
	case !answered(r.WeightSource):
		return UnrankedDefaultWeight
	case r.WeightChangedAt != 0 && within(r.WeightChangedAt, RaceWeightFreezeDays):
		return UnrankedFreshWeight
	case r.WeightConfirmedAt == 0 || !within(r.WeightConfirmedAt, RaceWeightConfirmDays):
		return UnrankedUnconfirmedWeight
	}
	return ""
}

// RaceFtp is the FTP a race freezes at its flag (ADR-0067): the profile's, or
// the suggestion from the 90-day best 20 minutes when it makes one.
func RaceFtp(r Rider) int {
	if suggested, ok := SuggestFTP(r.Best20mWatts, r.FtpWatts); ok {
		return suggested
	}
	return r.FtpWatts
}

// RaceCategory is the bracket a race places a rider in, from the race FTP's
// 20 minutes (docs/SPEC.md: FTP is 0.95 × the best 20): the 90-day best
// wherever the suggestion made the race FTP, so a profile FTP set low cannot
// drop a rider a bracket, and one set higher is read as the rider claims it.
func RaceCategory(r Rider) string {
	return Category(int(math.Round(float64(RaceFtp(r))/0.95)), float64(r.WeightKg))
}

// answered: somebody chose the number — the rider, or a ramp test. No word at
// all is the default's reading too, since only SourceOf fills the field.
func answered(source string) bool {
	return source != "" && source != SourceDefault
}

// RaceVoidTooFew is a race whose flag found fewer than RaceMinRiders on the
// session's timeline: it never starts, and says so.
const RaceVoidTooFew = "too_few"

// Drive is how a rider's trainer rides a road, as their screen says when it
// opens and whenever it changes (#3658): ErgByRoad is "Don't make me shift",
// where WattRoom holds the watts, which a race rides unranked.
type Drive struct {
	ErgByRoad bool `json:"ergByRoad"`
}

// RaceState is a race on the tick (#3658, ADR-0067): when the flag drops and
// when the klaxon sends it from km 0, whether the coach has neutralised it,
// and — once it is done — the closing card. The places ride World.Racers.
type RaceState struct {
	FlagAtMs    int64 `json:"flagAtMs"`
	KlaxonAtMs  int64 `json:"klaxonAtMs"`
	Neutralised bool  `json:"neutralised,omitempty"`
	// Why the race never started: RaceVoidTooFew.
	Void string `json:"void,omitempty"`
	// The closing card, per Category D–A. Never stored (ADR-0074).
	Results []RaceBracket `json:"results,omitempty"`
}

// RaceBracket is one Category on the closing card: its finishers in order,
// the ones the race could not place — shown, and told why — and whether the
// Category had one rider, who "rode alone".
type RaceBracket struct {
	Category string         `json:"category"`
	Placed   []RaceFinisher `json:"placed,omitempty"`
	Unranked []RaceFinisher `json:"unranked,omitempty"`
	Alone    bool           `json:"alone,omitempty"`
}

// RaceFinisher is one rider over the line: their time from the klaxon to the
// millisecond, and why they are unplaced (an Unranked reason), if they are.
type RaceFinisher struct {
	RiderID string `json:"riderId"`
	Name    string `json:"name"`
	Ms      int64  `json:"ms"`
	Why     string `json:"why,omitempty"`
}
