/**
 * What the rider says about a finished ride, as opposed to what the trainer
 * recorded (#2328): a Borg CR10 rating and one sentence.
 *
 * The scale is docs/SPEC.md's and the bounds are generated from the Go
 * constants, so the picker cannot draw a button the server refuses. The
 * anchors below are the CR10's published words — 6, 8 and 9 carry none, which
 * is the scale's own design, and inventing words for them would not be the
 * CR10 any more.
 *
 * ADR-0055: the note never leaves the rider's own account. Nothing here
 * sends it anywhere but the owner-scoped endpoint.
 */
import { api, type ApiResult } from '$lib/api';
import { MinRPE, MaxRPE, MaxRideNoteChars } from '$lib/protocol';

export interface RideFeel {
	/** docs/SPEC.md's 1–10, or null on a ride the rider has not rated. */
	rpe: number | null;
	/** The rider's own sentence, or null. Private (ADR-0055). */
	note: string | null;
}

/** Every rating the picker offers, in order. */
export const RPE_SCALE: number[] = Array.from(
	{ length: MaxRPE - MinRPE + 1 },
	(_, i) => MinRPE + i,
);

/** The CR10's published anchors; the unlisted values are steps between them. */
const ANCHORS: Record<number, string> = {
	1: 'very easy',
	2: 'easy',
	3: 'moderate',
	4: 'somewhat hard',
	5: 'hard',
	7: 'very hard',
	10: 'maximal',
};

/**
 * What a rating is called: its published anchor, or nothing. 6, 8 and 9
 * carry no word in the CR10 (docs/SPEC.md "How a ride felt"), and naming
 * them — "harder than hard" — would make it a different scale (#2634).
 */
export function rpeLabel(rpe: number): string {
	return ANCHORS[rpe] ?? '';
}

/** A rating as the picker writes it: "7 — very hard", or "6 of 10". */
export function rpeText(rpe: number): string {
	const word = rpeLabel(rpe);
	return word ? `${rpe} — ${word}` : `${rpe} of 10`;
}

/** True when the box holds more than the server will take. */
export function noteTooLong(note: string): boolean {
	return [...note.trim()].length > MaxRideNoteChars;
}

/**
 * Write both halves at once — one PUT that replaces the pair, because they
 * are one thing a rider fills in once. An empty note clears the column; the
 * server trims and decides, so the box never has to.
 */
export function setRideFeel(
	id: string,
	feel: RideFeel,
): Promise<ApiResult<RideFeel>> {
	return api<RideFeel>(`/api/rides/${encodeURIComponent(id)}/feel`, {
		method: 'PUT',
		json: { rpe: feel.rpe, note: feel.note },
	});
}
