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

// From docs/SPEC.md: the rider's two numbers (ADR-0048) and the anchor the HR
// zones derive from (ADR-0014). Both sides read these; neither retypes them.
const (
	MinFtpWatts = 50
	MaxFtpWatts = 600
	MinWeightKg = 30
	MaxWeightKg = 200
	MinLthrBpm  = 100
	MaxLthrBpm  = 210
)
