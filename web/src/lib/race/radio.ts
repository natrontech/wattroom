import type { RaceReadout } from './race-view';

/**
 * The team-car radio (#3174): what the race is doing, in a handful of closed
 * phrases — never free text — and at most one call every 20 s. Calls that
 * wait are kept one per kind, the newest, and the most pressing goes first
 * when the radio may speak again. It never says a number the RACE page
 * shows — the place, the gap to par — so each has one home (docs/design/
 * TARGETS.md "One home per number").
 */
export const RADIO_SPACING_S = 20;

/** Metres to the line the radio counts down. */
const MARKS = [10_000, 5_000, 2_000, 1_000, 500];

export type CallKind =
	'finish' | 'held' | 'resumed' | 'klaxon' | 'neutral' | 'distance';

export interface RadioCall {
	kind: CallKind;
	text: string;
}

const PRIORITY: Record<CallKind, number> = {
	finish: 7,
	held: 6,
	resumed: 5,
	klaxon: 4,
	neutral: 3,
	distance: 2,
};
/** The calls a change of phase makes stale. */
const PHASED: CallKind[] = ['neutral', 'klaxon', 'held', 'resumed'];

/** Every phrase the radio has: the race's numbers go in, nothing else does. */
export const PHRASES = {
	neutral: () => 'Neutral zone. Roll easy to km 0.',
	klaxon: () => 'km 0. Race on.',
	held: () => 'Race held. Nobody moves.',
	resumed: () => 'Race back on.',
	distance: (m: number) =>
		m >= 1000 ? `${m / 1000} km to the line.` : `${m} m to the line.`,
	finish: () => 'Over the line.',
} as const;

/** What changed between two looks at the race, as calls. */
function callsBetween(was: RaceReadout | null, now: RaceReadout): RadioCall[] {
	const calls: RadioCall[] = [];
	const call = (kind: CallKind, text: string) => calls.push({ kind, text });
	if (now.phase !== was?.phase)
		switch (now.phase) {
			case 'neutral':
				call('neutral', PHRASES.neutral());
				break;
			case 'held':
				call('held', PHRASES.held());
				break;
			case 'finished':
				call('finish', PHRASES.finish());
				break;
			case 'racing':
				if (was?.phase === 'held') call('resumed', PHRASES.resumed());
				else call('klaxon', PHRASES.klaxon());
		}
	if (now.phase !== 'racing') return calls;
	const mark = MARKS.find((m) => was && was.toLine > m && now.toLine <= m);
	if (mark) call('distance', PHRASES.distance(mark));
	return calls;
}

/** One screen's radio: hear the race each tick, and say what it says, when it may. */
export function createRadio() {
	let was: RaceReadout | null = null;
	let saidAt = -Infinity;
	const waiting = new Map<CallKind, RadioCall>();
	return {
		/** This tick's race at `t` seconds: the call to make now, or null. */
		hear(race: RaceReadout, t: number): RadioCall | null {
			const calls = callsBetween(was, race);
			if (race.phase !== was?.phase) for (const k of PHASED) waiting.delete(k);
			for (const c of calls) waiting.set(c.kind, c);
			was = race;
			if (t - saidAt < RADIO_SPACING_S || waiting.size === 0) return null;
			const next = [...waiting.values()].sort(
				(a, b) => PRIORITY[b.kind] - PRIORITY[a.kind],
			)[0];
			waiting.delete(next.kind);
			saidAt = t;
			return next;
		},
	};
}
