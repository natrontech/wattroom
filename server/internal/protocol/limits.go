/*
Bounds docs/SPEC.md sets, declared once here and generated into
web/src/lib/protocol.ts with the message types (#2122).

`.claude/rules/errors.md` says "Bounds from docs/SPEC.md, never invented", and
both sides obeyed it by typing the numbers out separately — so they drifted,
twice, and a rider found it both times: #1393's workout JSON and #1986's name
limits. A number the two sides have to agree on gets one declaration for the
same reason the message types do, and CI failing on a stale protocol.ts is
what makes this a seam rather than a third copy.

The schema CHECKs are the exception that stays a literal: a migration is
immutable once it has run anywhere (ADR-0019), so it cannot read a constant a
later release is free to change. Widening a bound is therefore two edits — the
block below, and an expand migration.
*/

package protocol

import "math"

// From docs/SPEC.md: the rider's two numbers (ADR-0048) and the anchor the HR
// zones derive from (ADR-0014). Both sides read these; neither retypes them.
const (
	MinFtpWatts = 50
	MaxFtpWatts = 600
	MinWeightKg = 30
	MaxWeightKg = 200
	MinLthrBpm  = 100
	MaxLthrBpm  = 210

	// A chat line, in CHARACTERS: the server counts runes because counting
	// bytes cut non-Latin scripts off at half the advertised limit (#219),
	// and the box that types it has to cap at the same number.
	MaxMessageChars = 500

	// The two codes a rider is handed, and the one thing that tells them
	// apart at a glance (#1236): a friend's is eight characters, a crew's
	// six. Both sides check the length to say WHICH door a pasted code is
	// for, so both sides have to agree on it.
	FriendCodeLen = 8
	CrewCodeLen   = 6

	// What the rider says about a finished ride (#2328, docs/SPEC.md "How a
	// ride felt"): the Borg CR10 session rating, and the sentence beside it.
	// 0 is CR10's "rest" and no saved ride is one, so the floor is 1. The
	// picker draws exactly this many buttons and the server refuses anything
	// else, which is only true while both read the same pair.
	MinRPE = 1
	MaxRPE = 10

	// A ride note, in CHARACTERS — runes, MaxMessageChars' rule. Its own
	// constant rather than a second name for that one: the two happen to
	// agree on 500 today, and a chat line's limit moving is no reason for a
	// note's to follow.
	MaxRideNoteChars = 500

	// A crew's pin board (ADR-0056, docs/SPEC.md "Pins"). Both sides read
	// these: the editor caps its boxes at the first two, the server refuses
	// anything longer, and the count is what the "Pin something" button
	// disables itself on rather than letting a rider write a pin the POST
	// will then refuse.
	//
	// The two lengths are in CHARACTERS — runes, MaxMessageChars' rule.
	MaxPinTitleChars = 40
	MaxPinBodyChars  = 1000
	// Twenty is a board; two hundred is a wiki. The ceiling is what keeps a
	// pin worth reading — a crew that needs more of them needs a document,
	// and this feature is deliberately not one.
	MaxCrewPins = 20

	// A crew's reaction palette (#223, docs/SPEC.md): the picker stops at it
	// and the server refuses past it.
	MaxCheers = 8

	// A crew's own emoji (#2643, docs/SPEC.md): how many a crew holds and how
	// big one picture may be. The upload refuses past both, and the crew's
	// settings disable "Add emoji" at the count rather than offering an
	// upload the POST will refuse. A name is MinEmojiNameChars to
	// MaxEmojiNameChars of a–z, 0–9 and _ — ASCII, so bytes and characters
	// agree — and the crew_emoji CHECK holds the same pair as a literal.
	MaxCrewEmoji      = 50
	MaxEmojiBytes     = 256 << 10
	MinEmojiNameChars = 2
	MaxEmojiNameChars = 32

	// A rider's status line (ADR-0060, docs/SPEC.md "Personal status"), in
	// CHARACTERS — MaxMessageChars' rule.
	MaxStatusChars = 100

	// A crew's name (docs/SPEC.md "Names"), in CHARACTERS — MaxMessageChars'
	// rule.
	MaxCrewNameChars = 60
	// How many crews a rider founds (docs/SPEC.md "Caps", default — tune in
	// alpha), counted over the crews they founded and still own. "Start a
	// crew" disables at it rather than offering a POST that is refused.
	MaxFoundedCrews = 3

	// A channel's name (ADR-0058, docs/SPEC.md "Names"), in CHARACTERS —
	// MaxMessageChars' rule — and the bound the channels table's CHECK holds.
	MaxChannelNameChars = 60
	// How many text channels a crew holds (docs/SPEC.md "Caps", default —
	// tune in alpha). The settings page disables "New channel" at it rather
	// than offering a create the POST will refuse.
	MaxCrewTextChannels = 20
	// How many voice channels a crew holds — MaxCrewTextChannels' rule.
	MaxCrewVoiceChannels = 10

	// The tolerance band a second is scored in: within ±5 % of target, floor
	// ±10 W (#2159). The floor is what keeps an easy block scoreable — at
	// 60 W, 5 % is 3 W, which is inside a trainer's own error.
	TargetBandFraction   = 0.05
	TargetBandFloorWatts = 10

	// A temporary message's timer (#2644, docs/SPEC.md "Text channel chat"),
	// in seconds: the three a sender picks from. The composer offers exactly
	// these and the server refuses any other, so both read them from here.
	TemporaryHour = 60 * 60
	TemporaryDay  = 24 * TemporaryHour
	TemporaryWeek = 7 * TemporaryDay

	// A route a rider imports (docs/SPEC.md "Route rides", ADR-0062): its
	// length, and the grade its stored road may carry. The browser reads the
	// file and the server keeps what the browser read (#3024), so both hold
	// the road to the same bounds.
	MinRouteMeters  = 2000
	MaxRouteMeters  = 200000
	MinRoadGradePct = -15
	MaxRoadGradePct = 20

	// What a crew is sent of a route that is not theirs (ADR-0063, #3051):
	// the road between its anchors, which until the geo pack draws zones are
	// this far in from each end — a route hides its first and last metres by
	// default — and at most this many bytes of it, packed, on a workout.
	RouteHiddenEndM      = 400
	MaxAttachedRoadBytes = 48 << 10

	// A leg (docs/SPEC.md "Route rides"): the stretch of a route ridden in
	// one sitting is at most six hours, so a long route compiles into legs.
	MaxLegSeconds = 6 * 60 * 60

	// The range every SIM write is clamped to (docs/SPEC.md "Route rides",
	// ADR-0062): one range for every trainer, since FTMS cannot report an
	// indoor bike's. MaxTrainerGrade is also the free ride's top and the felt
	// grade's; MinTrainerGrade is a default until hardware check P11 measures
	// a trainer's descent, and the room below the felt floor is for virtual
	// gears (ADR-0084).
	MinTrainerGrade = -10
	MaxTrainerGrade = 15

	// A sample on a road (#3052): its place along the road runs from 0 to the
	// route's length (MaxRouteMeters above), never back, and at most this far
	// a second; its height stays inside these. The floor is the .fit's own —
	// enhanced_altitude cannot say lower than −500 m.
	MaxRoadSpeedMps = 30
	MinRoadAltM     = -500
	MaxRoadAltM     = 9000

	// docs/SPEC.md "Road times": an effort whose mean shelter exceeds 5 % is
	// untimeable (ADR-0074, ADR-0077), as a fraction of the air.
	MaxTimeableShelter = 0.05

	// The pace model (docs/SPEC.md "Route rides", #3048): what turns a
	// rider's watts into speed on a road. The client's dot, the hub's bunch,
	// stats replay and races all read this one model, in $lib/road/pace.ts
	// and internal/road — two that disagree put riders on different metres
	// on different screens.
	PaceCrr                  = 0.004
	PaceAirDensity           = 1.225 // kg/m³
	PaceDrivetrainEfficiency = 0.97
	PaceGravity              = 9.80665 // m/s², standard gravity
	// The CdA a road is ridden at, m², until the Kickr sessions measure one
	// (#3025, #3331). The golden vectors carry CdA as an input, so a measured
	// value adds vectors at it and moves this default.
	PaceDefaultCdA = 0.32
	// Substeps in each one-second step. Not a SPEC number, but both twins
	// have to take the same ones to land on the same metre.
	PaceSubsteps = 4
	// Corners (#3204, defaults — tune in alpha): the sideways acceleration a
	// rider takes a bend at, in g — 0.6 g is a 31° lean, so a corner of
	// radius r holds √(0.6·g·r) — and how hard the pace brakes to meet it,
	// in m/s². No brake control: a rider on a trainer never touches one.
	PaceCornerG   = 0.6
	PaceBrakeMps2 = 4

	// Drafting (docs/SPEC.md "Drafting", ADR-0077): the share of the air a
	// wheel ahead takes — the second wheel's, the third's, and every later
	// one's, which is also the cap on any shelter (a rule) — at full strength
	// within ShelterFullGapM of that wheel, fading linearly to none at
	// ShelterNoneGapM, and halved from the adjacent lane.
	ShelterSecondWheel = 0.35
	ShelterThirdWheel  = 0.45
	ShelterMax         = 0.5
	ShelterFullGapM    = 1.0
	ShelterNoneGapM    = 6
	ShelterAdjacent    = 0.5

	// The critical-power model (#3262, docs/SPEC.md "Stats formulas" — the
	// curve keeps 3 and 12 min for it): CP and W′ come from the rider's
	// 90-day bests at this two-point pair, in seconds, and from the 5/20-min
	// pair — flagged an estimate — until the curve holds both.
	CPShortSeconds         = 180
	CPLongSeconds          = 720
	CPEstimateShortSeconds = 300
	CPEstimateLongSeconds  = 1200

	// Climbs (docs/SPEC.md "Climbs", Garmin's rule; #3047, #3238): at least
	// ClimbMinM long, averaging ClimbMinPct, scoring ClimbMinScore — length
	// in m × average %, 100 × the gain. A class is held when the score is
	// above its floor. A dip that loses less than ClimbDipLossM and is back
	// over the top within ClimbDipM does not end a climb, and a road keeps
	// its hardest MaxClimbs. $lib/road/climbs.ts and internal/road run the one
	// rule on these.
	ClimbMinM     = 500
	ClimbMinPct   = 3
	ClimbMinScore = 1500
	ClimbClassIV  = 8000
	ClimbClassIII = 16000
	ClimbClassII  = 32000
	ClimbClassI   = 64000
	ClimbClassHC  = 80000
	ClimbDipLossM = 20
	ClimbDipM     = 300
	MaxClimbs     = 32
	// The reference rider (docs/SPEC.md): 75 kg on an 8 kg bike at 225 W —
	// whom a road's estimates are made for when no real rider is in question.
	ReferenceRiderKg    = 75
	BikeKg              = 8
	ReferenceRiderWatts = 225

	// One reconnect replay frame, in samples: an hour of the ride buffer's
	// one row a second (audit 2026-09-09). The hub takes one frame a second
	// per rider and cuts a longer one, so the client sends a longer outage
	// in frames of this size, a second apart (#2839). Not a SPEC number, but
	// one both sides have to agree on.
	MaxBackfillBatch = 60 * 60
)

// TargetBand is docs/SPEC.md's band around a target, in watts.
//
// Here rather than in `stats`, which owns the scoring rule, because `hub`
// needs the same number and does not import `stats` — and a second copy of a
// SPEC number is exactly what #2122 is about. The web app has one of these
// too (`$lib/workout/guards.ts`), reading the constants above through the
// generated protocol.
func TargetBand(target float64) float64 {
	return math.Max(target*TargetBandFraction, TargetBandFloorWatts)
}

// IsTemporaryTimer reports whether seconds is one of the timers a sender may
// set on a message (#2644).
func IsTemporaryTimer(seconds int) bool {
	return seconds == TemporaryHour || seconds == TemporaryDay || seconds == TemporaryWeek
}
