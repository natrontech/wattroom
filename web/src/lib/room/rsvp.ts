/**
 * A planned session's answers (#1011).
 *
 * A rider still has two things to say — in, or out (docs/SPEC.md's glossary:
 * there is no maybe). The third state is the room not having heard from them,
 * which is why it is stored as the absence of an answer and spelled `null`
 * here rather than as a word of its own.
 */
export type RsvpAnswer = 'in' | 'out';

export interface RsvpTally {
	/** Named on screen — the room reads who is in. */
	in: number;
	/** A NUMBER on screen, never a list: the count is what tells a planner
	 *  whether to hold the session, and the names would only add pressure to
	 *  a decision a rider already made. Rooms are small. */
	out: number;
	unanswered: number;
}

/** The line under a plan: "4 in · 2 out · 9 unanswered". */
export function rsvpSummary(tally: RsvpTally): string {
	const parts: string[] = [];
	// A part that is nobody is left out — "0 out" is a sentence about
	// nothing, and three of them is a row of noise on a phone.
	if (tally.in > 0) parts.push(`${tally.in} in`);
	if (tally.out > 0) parts.push(`${tally.out} out`);
	if (tally.unanswered > 0) parts.push(`${tally.unanswered} unanswered`);
	// Empty states teach rather than apologise (ux.md) — and this one says
	// what the buttons beside it are for.
	if (parts.length === 0) return 'nobody has answered yet';
	return parts.join(' · ');
}
