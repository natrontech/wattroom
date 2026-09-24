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
