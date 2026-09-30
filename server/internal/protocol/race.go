package protocol

import "time"

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
)

// Unranked is why a race whose flag drops at flag cannot place r, or "" when
// it can. A race reads it once, at the flag, beside the FTP and weight it
// freezes there — the race FTP being stats.SuggestFTP's number when it makes
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

// answered: somebody chose the number — the rider, or a ramp test. No word at
// all is the default's reading too, since only SourceOf fills the field.
func answered(source string) bool {
	return source != "" && source != SourceDefault
}
