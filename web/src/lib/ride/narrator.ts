import type { MomentEvent } from '$lib/moments';
import type { ClimbView } from '$lib/ride/climb-view';
import { formatKm } from '$lib/format';

/** At most one polite line this often (#3213, WCAG 4.1.3): a screen reader queues, it does not skip. */
export const POLITE_GAP_MS = 5000;

export interface Narration {
	polite: string;
	alert: string;
	/** Bump on every spoken line, so a repeated sentence is announced again. */
	politeSeq: number;
	alertSeq: number;
}

/**
 * The ride narrator's voice (#3213): what the sr-only live regions say. Polite
 * lines are rate limited and a newer one replaces a waiting older one; an alert
 * is never held back. Pure, on an injected clock: `tick()` releases the
 * waiting polite line once the gap has passed.
 */
export function createNarrator(
	now: () => number,
	onChange: (n: Narration) => void,
) {
	const state: Narration = { polite: '', alert: '', politeSeq: 0, alertSeq: 0 };
	let lastPoliteAt = -Infinity;
	let waiting = '';
	const emit = () => onChange({ ...state });
	const speak = (text: string) => {
		state.polite = text;
		state.politeSeq++;
		lastPoliteAt = now();
		waiting = '';
		emit();
	};
	return {
		polite(text: string) {
			// The climb and the moments queue both say "Summit": once is enough.
			if (text === state.polite && now() - lastPoliteAt < POLITE_GAP_MS) return;
			if (now() - lastPoliteAt >= POLITE_GAP_MS) speak(text);
			else waiting = text;
		},
		alert(text: string) {
			state.alert = text;
			state.alertSeq++;
			emit();
		},
		tick() {
			if (waiting && now() - lastPoliteAt >= POLITE_GAP_MS) speak(waiting);
		},
	};
}

const km = (m: number) => `${formatKm(m)} km`;

/** A classed climb opens: its class, length and average grade. */
export function climbStartLine(v: ClimbView): string {
	const length = v.climb.topM - v.climb.startM;
	const avg = ((v.climb.gainM / length) * 100).toFixed(1);
	return `Climb ${v.card.n} of ${v.card.of}, class ${v.climb.cls}, ${km(length)}, average ${avg} %`;
}

/** "2 km to the top", at each whole kilometre left on a climb. */
export function toTopLine(wholeKm: number): string {
	return `${wholeKm} km to the top`;
}

export const SUMMIT_LINE = 'Summit';

/** What the moments queue's stage says as a moment enters (#3210). */
export function momentLine(e: MomentEvent): string | null {
	if (e.stage !== 'enter') return null;
	switch (e.kind) {
		case 'finish':
			return 'Finish';
		case 'summit':
			return SUMMIT_LINE;
		case 'result':
			return 'Result in';
		case 'pr':
			return 'Personal record';
		case 'dockin':
		case 'climb':
		case 'flamme':
			return null;
	}
}

export const SPRINT_LINE = 'Sprint armed';

/** Who came and went between two rosters (yours is not in them): "Anna joined", "Anna and Tom left". */
export function crewLines(
	before: ReadonlyMap<string, string>,
	after: ReadonlyMap<string, string>,
): string[] {
	const names = (from: ReadonlyMap<string, string>, not: typeof from) =>
		[...from].filter(([id]) => !not.has(id)).map(([, name]) => name);
	const say = (who: string[], verb: string) =>
		who.length ? [`${who.join(' and ')} ${verb}`] : [];
	return [
		...say(names(after, before), 'joined'),
		...say(names(before, after), 'left'),
	];
}

export const blockLine = (label: string) => `Block: ${label}`;
export const trainerLine = (lost: boolean) =>
	lost ? 'Trainer signal lost' : 'Trainer signal back';

/** The S key: "km 12.4 of 51.7, 5.8 %, 6.0 km to the top, 258 W, zone 3". */
export function stateLine(s: {
	m: number;
	lengthM: number;
	grade: number;
	toTopM?: number;
	watts: number;
	zone: number;
}): string {
	return [
		`km ${formatKm(s.m)} of ${formatKm(s.lengthM)}`,
		`${s.grade.toFixed(1)} %`,
		...(s.toTopM !== undefined ? [`${km(s.toTopM)} to the top`] : []),
		`${Math.round(s.watts)} W`,
		`zone ${s.zone}`,
	].join(', ');
}
