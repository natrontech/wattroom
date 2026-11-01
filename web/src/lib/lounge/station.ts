/**
 * House radio's score (ADR-0094): every tune is a pure function of the crew
 * and its time slot, so two screens that agree on server time play the same
 * bar and nothing crosses the wire. The sound is house-radio.ts's.
 */
import { hashSeed, prng } from '$lib/world/rand';
import {
	ARPS,
	BASSES,
	BASS_LINES,
	COMPS,
	FIRST,
	FORMS,
	KEYS_VOICES,
	KICKS,
	KITS,
	LEADS,
	MAJOR,
	MINOR,
	QUALITY,
	SCALES,
	SECOND,
	TEMPOS,
} from '$lib/lounge/station-tables';

/** One tune per slot, in seconds. */
export const SLOT_SEC = 150;
export const KEY_NAMES = [
	'C',
	'Db',
	'D',
	'Eb',
	'E',
	'F',
	'Gb',
	'G',
	'Ab',
	'A',
	'Bb',
	'B',
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
	mode: 'major' | 'minor';
	bpm: number;
	barSec: number;
	bars: number;
	/** Four or eight bars, round again. */
	chords: Chord[];
	form: Section[];
	keys: (typeof KEYS_VOICES)[number];
	lead: (typeof LEADS)[number];
	bass: (typeof BASSES)[number];
	bassLine: (typeof BASS_LINES)[number];
	kit: (typeof KITS)[number];
	/** The snare on beat three only. */
	halfTime: boolean;
	/** Hats on every sixteenth rather than every eighth. */
	hats16: boolean;
	kicks: number[];
	comp: number[];
	/** Broken chords in the groove and melody, in place of the comp; null strikes them whole. */
	arp: (number | null)[] | null;
	/** 0.5 is straight; the eighths lean later the higher it is. */
	swing: number;
	/** Four bars of eighths: a scale step, or null for a rest. Bars three and four answer one and two. */
	motif: (number | null)[];
	melodyBase: number;
	melody: boolean;
	/** The tone control wide open, in Hz: darker or brighter tape. */
	open: number;
	/** How loud the vinyl crackles, 0–1. */
	crackle: number;
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
	const mode = r() < 0.5 ? 'minor' : 'major';
	const bpm = pick(TEMPOS);
	const book = mode === 'minor' ? MINOR : MAJOR;
	const steps = r() < 0.4 ? [...pick(book), ...pick(book)] : pick(book);
	const chords = steps.map(([step, quality]) => {
		const pc = (key + step) % 12;
		const notes = QUALITY[quality]
			.map((iv) => fold(48 + pc + iv, 52, 76))
			.sort((a, b) => a - b);
		return { bass: 36 + pc, notes };
	});
	const scale = SCALES[mode];
	const density = 0.25 + r() * 0.25;
	const phrase = () =>
		Array.from({ length: 16 }, () =>
			r() < density ? pick(scale) + (r() < 0.25 ? 12 : 0) : null,
		);
	const ask = phrase();
	if (ask.filter((n) => n !== null).length < 4)
		Object.assign(ask, { 0: scale[2], 3: scale[3], 6: scale[4], 10: scale[3] });
	// The answer keeps the first bar and comes home on the tonic.
	const answer = [
		...ask.slice(0, 8),
		...phrase().slice(0, 4),
		0,
		null,
		null,
		null,
	];
	const keys = pick(KEYS_VOICES);
	const barSec = 240 / bpm;
	const tune: Tune = {
		slot,
		key,
		mode,
		bpm,
		barSec,
		bars: Math.floor((SLOT_SEC - 2) / barSec),
		chords,
		form: pick(FORMS),
		keys,
		lead: pick(LEADS),
		bass: pick(BASSES),
		bassLine: pick(BASS_LINES),
		kit: pick(KITS),
		halfTime: r() < 0.25,
		hats16: r() < 0.3,
		kicks: pick(KICKS),
		comp: pick(COMPS),
		arp: keys !== 'pad' && r() < 0.35 ? pick(ARPS) : null,
		swing: 0.53 + r() * 0.1,
		motif: [...ask, ...answer],
		melodyBase: key > 6 ? 48 + key : 60 + key,
		melody: r() < 0.85,
		open: 2200 + Math.floor(r() * 2000),
		crackle: 0.15 + r() * 0.45,
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
	return tune.form[Math.floor((bar - 4) / 8) % tune.form.length];
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

/** The melody's note on one eighth, or null; every other four-bar phrase varies it. */
export function melodyNote(
	tune: Tune,
	bar: number,
	eighth: number,
	varied: boolean,
): number | null {
	let step = tune.motif[(bar % 4) * 8 + eighth];
	if (step === null) return null;
	if (varied && Math.floor(bar / 4) % 2 === 1) {
		const scale = SCALES[tune.mode];
		const at = scale.indexOf(step % 12);
		step = scale[(at + 1) % scale.length] + (step >= 12 ? 12 : 0);
	}
	const note = tune.melodyBase + step;
	return note > 81 ? note - 12 : note;
}
