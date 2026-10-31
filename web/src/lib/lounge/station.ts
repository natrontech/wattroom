/**
 * House radio's score (ADR-0094): every tune is a pure function of the crew
 * and its time slot, so two screens that agree on server time play the same
 * bar and nothing crosses the wire. The sound is house-radio.ts's.
 */
import { hashSeed, prng } from '$lib/world/rand';

/** One tune per slot, in seconds. */
export const SLOT_SEC = 150;
export const KEY_NAMES = [
	'C',
	'D♭',
	'D',
	'E♭',
	'E',
	'F',
	'G♭',
	'G',
	'A♭',
	'A',
	'B♭',
	'B',
];
/** Chord colours above the root, which the bass plays. */
const QUALITY = {
	maj9: [4, 7, 11, 14],
	m9: [3, 7, 10, 14],
	dom9: [4, 7, 10, 14],
	m7: [3, 7, 10],
	m11: [3, 7, 10, 17],
	dom13: [4, 10, 14, 21],
} as const;
type Quality = keyof typeof QUALITY;
/** Four bars each, as scale steps from the key and a quality. */
const PROGRESSIONS: [number, Quality][][] = [
	[
		[2, 'm9'],
		[7, 'dom13'],
		[0, 'maj9'],
		[9, 'm9'],
	],
	[
		[0, 'maj9'],
		[9, 'm9'],
		[2, 'm9'],
		[7, 'dom9'],
	],
	[
		[5, 'maj9'],
		[4, 'm7'],
		[2, 'm9'],
		[0, 'maj9'],
	],
	[
		[9, 'm9'],
		[5, 'maj9'],
		[0, 'maj9'],
		[7, 'dom13'],
	],
	[
		[0, 'maj9'],
		[0, 'maj9'],
		[5, 'maj9'],
		[5, 'maj9'],
	],
	[
		[2, 'm11'],
		[7, 'dom9'],
		[4, 'm7'],
		[9, 'm9'],
	],
	[
		[5, 'maj9'],
		[7, 'dom13'],
		[4, 'm7'],
		[9, 'm11'],
	],
];
/** Kick placements on the bar's sixteenths; the snare is always 4 and 12. */
const KICKS = [
	[0, 10],
	[0, 7, 10],
	[0, 3, 10],
	[0, 6, 10],
];
/** Where the piano strikes, in eighths. */
const COMPS = [[0], [0, 3], [0, 5], [0, 3, 6], [0, 7]];
const TEMPOS = [72, 75, 78, 80, 82, 85, 88];
export const PENTATONIC = [0, 2, 4, 7, 9];
const FIRST = [
	'Late',
	'Slow',
	'Quiet',
	'Soft',
	'Low',
	'Night',
	'Easy',
	'Blue',
	'Warm',
	'Small',
	'Long',
	'Still',
];
const SECOND = [
	'Cadence',
	'Rollers',
	'Window',
	'Coffee',
	'Spin',
	'Draft',
	'Tempo',
	'Desk',
	'Lamp',
	'Rain',
	'Recovery',
	'Zone Two',
	'Cooldown',
	'Chainring',
];

export type Section =
	'intro' | 'groove' | 'melody' | 'breakdown' | 'outro' | 'gap';

export interface Chord {
	/** MIDI note of the root, in the bass's octave. */
	bass: number;
	/** The piano's rootless voicing, folded into one comfortable range. */
	notes: number[];
}

export interface Tune {
	slot: number;
	name: string;
	key: number;
	bpm: number;
	barSec: number;
	bars: number;
	chords: Chord[];
	kicks: number[];
	comp: number[];
	/** 0.5 is straight; the eighths lean later the higher it is. */
	swing: number;
	/** Two bars of eighths: a pentatonic step, or null for a rest. */
	motif: (number | null)[];
	melodyBase: number;
	melody: boolean;
}

const cache = new Map<string, Tune>();

/** The tune a crew's station plays in one slot. */
export function tuneOf(station: string, slot: number): Tune {
	const id = `${station}:${slot}`;
	const known = cache.get(id);
	if (known) return known;
	if (cache.size > 8) cache.clear();
	const r = prng(hashSeed(id));
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
	const key = Math.floor(r() * 12);
	const bpm = pick(TEMPOS);
	const chords = pick(PROGRESSIONS).map(([step, quality]) => {
		const pc = (key + step) % 12;
		const notes = QUALITY[quality]
			.map((iv) => fold(48 + pc + iv, 52, 76))
			.sort((a, b) => a - b);
		return { bass: 36 + pc, notes };
	});
	const motif = Array.from({ length: 16 }, () =>
		r() < 0.36 ? pick(PENTATONIC) + (r() < 0.25 ? 12 : 0) : null,
	);
	if (motif.filter((n) => n !== null).length < 4)
		Object.assign(motif, { 0: 4, 3: 7, 6: 9, 10: 7 });
	const barSec = 240 / bpm;
	const tune: Tune = {
		slot,
		key,
		bpm,
		barSec,
		bars: Math.floor((SLOT_SEC - 2) / barSec),
		chords,
		kicks: pick(KICKS),
		comp: pick(COMPS),
		swing: 0.55 + r() * 0.07,
		motif,
		melodyBase: key > 6 ? 48 + key : 60 + key,
		melody: r() < 0.85,
		name: `${pick(FIRST)} ${pick(SECOND)}`,
	};
	cache.set(id, tune);
	return tune;
}

function fold(note: number, lo: number, hi: number): number {
	while (note > hi) note -= 12;
	while (note < lo) note += 12;
	return note;
}

/** Four bars of intro and outro around blocks of eight; past the last bar, the gap. */
export function sectionOf(tune: Tune, bar: number): Section {
	if (bar < 4) return 'intro';
	if (bar >= tune.bars) return 'gap';
	if (bar >= tune.bars - 4) return 'outro';
	const blocks: Section[] = [
		'groove',
		'melody',
		'groove',
		'breakdown',
		'melody',
	];
	return blocks[Math.floor((bar - 4) / 8) % blocks.length];
}

export const drumsIn = (section: Section) =>
	section === 'groove' || section === 'melody';

export interface StationPosition {
	tune: Tune;
	bar: number;
	section: Section;
	/** Beats since the tune began: the scene's pulse. */
	beat: number;
	/** Seconds until the next tune. */
	left: number;
}

/** Where a station is at server time `sec`. */
export function positionAt(station: string, sec: number): StationPosition {
	const slot = Math.floor(sec / SLOT_SEC);
	const tune = tuneOf(station, slot);
	const into = sec - slot * SLOT_SEC;
	const bar = Math.min(tune.bars, Math.floor(into / tune.barSec));
	return {
		tune,
		bar,
		section: sectionOf(tune, bar),
		beat: into / (60 / tune.bpm),
		left: SLOT_SEC - into,
	};
}

/** The melody's note on one eighth, or null; every other pair of bars varies it. */
export function melodyNote(
	tune: Tune,
	bar: number,
	eighth: number,
	varied: boolean,
): number | null {
	let step = tune.motif[(bar % 2) * 8 + eighth];
	if (step === null) return null;
	if (varied && Math.floor(bar / 2) % 2 === 1) {
		const at = PENTATONIC.indexOf(step % 12);
		step = PENTATONIC[(at + 1) % PENTATONIC.length] + (step >= 12 ? 12 : 0);
	}
	const note = tune.melodyBase + step;
	return note > 81 ? note - 12 : note;
}
