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
	// Joined after the klaxon (#3175): they ride alongside from km 0, and
	// the race places only who started it.
	UnrankedLate = "late"
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

// RaceCategory is the bracket a race places a rider in: from the 90-day best
// 20 minutes (docs/SPEC.md), or from the 20 minutes the race FTP claims
// (FTP is 0.95 × the best 20) when that is higher — so a profile FTP set low
// cannot drop a rider a bracket, and one with no rides behind it is read as
// the rider claims it.
func RaceCategory(r Rider) string {
	claimed := int(math.Round(float64(RaceFtp(r)) / 0.95))
	return Category(max(r.Best20mWatts, claimed), float64(r.WeightKg))
}

// answered: somebody chose the number — the rider, or a ramp test. No word at
// all is the default's reading too, since only SourceOf fills the field.
func answered(source string) bool {
	return source != "" && source != SourceDefault
}

// Last Light (docs/SPEC.md "Races", #3171): a race against a shared clock
// of 10, 20 or 30 minutes — 20 when the coach does not say — ranked on the
// distance ridden, whose fog closes from LastLightFogFromM to
// LastLightFogToM over its final LastLightFogSeconds.
const (
	LastLightDefaultMinutes = 20
	LastLightFogFromM       = 3000
	LastLightFogToM         = 150
	LastLightFogSeconds     = 60
)

// Wheelrace (docs/SPEC.md "Races", #3172): a handicap race to a line its par
// time places, 15–45 minutes — 30 when the coach does not say — closed hard
// at par plus WheelraceClosePct per cent.
const (
	WheelraceMinMinutes     = 15
	WheelraceMaxMinutes     = 45
	WheelraceDefaultMinutes = 30
	WheelraceClosePct       = 15
)

// WheelraceLength reports whether a Wheelrace's par may be this many minutes.
func WheelraceLength(minutes int) bool {
	return minutes >= WheelraceMinMinutes && minutes <= WheelraceMaxMinutes
}

// LastLightLength reports whether a Last Light may run this many minutes.
func LastLightLength(minutes int) bool {
	return minutes == 10 || minutes == 20 || minutes == 30
}

// LastLightFog is how far a rider sees with `left` on Last Light's clock:
// the whole LastLightFogFromM until its final minute, closing at an even
// rate to LastLightFogToM as it runs out.
func LastLightFog(left time.Duration) float64 {
	share := min(max(left.Seconds()/LastLightFogSeconds, 0), 1)
	return LastLightFogToM + share*(LastLightFogFromM-LastLightFogToM)
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

// Category par (docs/SPEC.md "Races"): the W/kg each Category's par rides at
// on the race's physics, which the RACE page measures a rider's gap against
// (#3174) and the pacer rides (ADR-0068).
const (
	ParWkgD = 2.2
	ParWkgC = 2.85
	ParWkgB = 3.6
	ParWkgA = 4.3
)

// ParWkg is a Category's par, 0 for none.
func ParWkg(category string) float64 {
	switch category {
	case "D":
		return ParWkgD
	case "C":
		return ParWkgC
	case "B":
		return ParWkgB
	case "A":
		return ParWkgA
	}
	return 0
}

// RaceState is a race on the tick (#3658, ADR-0067): when the flag drops and
// when the klaxon sends it from km 0, whether the coach has neutralised it,
// and — once it is done — the closing card. The places ride World.Racers.
type RaceState struct {
	FlagAtMs    int64 `json:"flagAtMs"`
	KlaxonAtMs  int64 `json:"klaxonAtMs"`
	Neutralised bool  `json:"neutralised,omitempty"`
	// When the race runs out: Last Light's shared clock (#3171), or a
	// Wheelrace's hard close (#3172). Zero for a plain race to the line.
	EndsAtMs int64 `json:"endsAtMs,omitempty"`
	// How far Last Light's fog lets a rider see now.
	FogM float64 `json:"fogM,omitempty"`
	// Where a Wheelrace's line is, in metres from km 0 (#3172): short of the
	// road's end, where its par puts it.
	LineM float64 `json:"lineM,omitempty"`
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

// RaceFinisher is one rider on the card: their time from the klaxon to the
// millisecond once they crossed the line, how far they rode — what a clock
// race ranks on — and why they are unplaced (an Unranked reason), if they
// are.
type RaceFinisher struct {
	RiderID string  `json:"riderId"`
	Name    string  `json:"name"`
	Ms      int64   `json:"ms,omitempty"`
	M       float64 `json:"m"`
	Why     string  `json:"why,omitempty"`
}
