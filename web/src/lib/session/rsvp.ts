/**
 * A planned session's answers (#1011).
 *
 * A rider still has two things to say — in, or out (docs/SPEC.md's glossary:
 * there is no maybe). The third state is the crew not having heard from them,
 * which is why it is stored as the absence of an answer and spelled `null`
 * here rather than as a word of its own.
 */
export type RsvpAnswer = 'in' | 'out';

export interface RsvpTally {
	/** Named on screen — the crew reads who is in. */
	in: number;
	/** A NUMBER on screen, never a list: the count is what tells a planner
	 *  whether to hold the session, and the names would only add pressure to
	 *  a decision a rider already made. Crews are small. */
	out: number;
	unanswered: number;
}

/**
 * The line under a plan: "4 in — Ada, Kim · 2 out · 9 unanswered".
 *
 * `whoIsIn` is the riders who said yes, already shortened for the width it
 * has. It binds to the `in` count and to nothing else, ever — the names were
 * a span of their own beside the counts for one afternoon, which put them
 * next to "2 out" on a phone and read as a list of who had declined. The one
 * thing this line must never do.
 */
export function rsvpSummary(tally: RsvpTally, whoIsIn = ''): string {
	// Empty states teach rather than count (ux.md). A fresh plan in a crew of
	// nine would otherwise open on "9 unanswered", which is a true sentence
	// about nobody and says nothing about the buttons beside it.
	if (tally.in === 0 && tally.out === 0) return 'nobody has answered yet';
	const parts: string[] = [];
	// A part that is nobody is left out — "0 out" is a sentence about
	// nothing, and three of them is a row of noise on a phone.
	if (tally.in > 0) {
		parts.push(whoIsIn ? `${tally.in} in — ${whoIsIn}` : `${tally.in} in`);
	}
	if (tally.out > 0) parts.push(`${tally.out} out`);
	if (tally.unanswered > 0) parts.push(`${tally.unanswered} unanswered`);
	return parts.join(' · ');
}

/** A plan's answers as the crew's schedule sends them. */
export interface PlanAnswers {
	/** Who said they are in, first to say so first. */
	going?: { id: string; displayName: string }[];
	out?: number;
	unanswered?: number;
	/** Your own answer; absent while you have not given one. */
	yourAnswer?: RsvpAnswer;
}

export function tallyOf(plan: PlanAnswers): RsvpTally {
	return {
		in: plan.going?.length ?? 0,
		out: plan.out ?? 0,
		unanswered: plan.unanswered ?? 0,
	};
}

/** The riders who are in, as a row has width for. */
export function whoIsInOf(plan: PlanAnswers): string {
	const names = plan.going ?? [];
	const shown = names
		.slice(0, 4)
		.map((who) => who.displayName)
		.join(', ');
	return names.length > 4 ? `${shown} +${names.length - 4} more` : shown;
}
