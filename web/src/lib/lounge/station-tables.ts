/**
 * House radio's material (ADR-0094, #4302): the chords, grooves, forms,
 * instruments and names a tune is drawn from. station.ts does the drawing.
 */
import type { Section } from '$lib/lounge/station';

/** Chord colours above the root, which the bass plays. */
export const QUALITY = {
	maj9: [4, 7, 11, 14],
	m9: [3, 7, 10, 14],
	dom9: [4, 7, 10, 14],
	m7: [3, 7, 10],
	m11: [3, 7, 10, 17],
	dom13: [4, 10, 14, 21],
	m7b5: [3, 6, 10],
} as const;
export type Quality = keyof typeof QUALITY;
/** Four bars each, as steps from the key's tonic and a quality. */
export const MAJOR: [number, Quality][][] = [
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
export const MINOR: [number, Quality][][] = [
	[
		[0, 'm9'],
		[5, 'm9'],
		[10, 'dom9'],
		[3, 'maj9'],
	],
	[
		[0, 'm9'],
		[8, 'maj9'],
		[3, 'maj9'],
		[10, 'dom13'],
	],
	[
		[5, 'm9'],
		[10, 'dom9'],
		[0, 'm9'],
		[0, 'm11'],
	],
	[
		[0, 'm11'],
		[7, 'm7'],
		[8, 'maj9'],
		[7, 'dom9'],
	],
	[
		[0, 'm9'],
		[2, 'm7b5'],
		[7, 'dom9'],
		[0, 'm9'],
	],
	[
		[8, 'maj9'],
		[10, 'dom13'],
		[0, 'm9'],
		[0, 'm9'],
	],
];
/** Kick placements on the bar's sixteenths; the snare is always 4 and 12. */
export const KICKS = [
	[0, 10],
	[0, 7, 10],
	[0, 3, 10],
	[0, 6, 10],
];
/** Where the keys strike, in eighths. */
export const COMPS = [[0], [0, 3], [0, 5], [0, 3, 6], [0, 7], [0, 2, 5]];
/** Broken chords: which chord tone each eighth plays, or null to rest. */
export const ARPS: (number | null)[][] = [
	[0, 1, 2, 3, 2, 1, 0, null],
	[0, 2, 1, 3, 0, 2, 1, 3],
	[0, null, 1, 2, null, 3, 2, null],
	[3, 2, 1, 0, 1, 2, null, null],
];
export const TEMPOS = [64, 68, 70, 72, 75, 78, 80, 82, 85, 88, 92];
/** The melody's notes: major and minor pentatonic over the key's tonic. */
export const SCALES = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] };
/** Eight-bar blocks between the intro and the outro, in order and round again. */
export const FORMS: Section[][] = [
	['groove', 'melody', 'groove', 'breakdown', 'melody'],
	['melody', 'groove', 'breakdown', 'melody', 'melody'],
	['groove', 'groove', 'melody', 'breakdown', 'melody'],
	['breakdown', 'groove', 'melody', 'melody', 'groove'],
	['melody', 'breakdown', 'groove', 'melody', 'breakdown'],
];
export const KEYS_VOICES = ['rhodes', 'pad', 'organ', 'pluck'] as const;
export const LEADS = ['flute', 'bell', 'square', 'whistle'] as const;
export const BASSES = ['round', 'sub', 'upright'] as const;
export const KITS = ['boom', 'brush', 'rim'] as const;
/** Whole notes, root and fifth on the half, or a walk through the chord on each beat. */
export const BASS_LINES = ['sparse', 'pulse', 'walk'] as const;
export const FIRST = [
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
export const SECOND = [
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
