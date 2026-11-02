/**
 * House radio's score (ADR-0094): every tune is a pure function of the crew
 * and its time slot, so two screens that agree on server time play the same
 * bar and nothing crosses the wire. barNotes() writes each bar out note by
 * note, varied bar to bar and block to block from the same seed; the sound
 * is house-radio.ts's.
 */
import { hashSeed, prng } from '$lib/world/rand';
import {
	ARPS,
	BASSES,
	BASS_LINES,
	CHIP_ARPS,
	COMPS,
	FILLS,
	FIRST,
	FORMS,
	GHOSTS,
	KEYS_VOICES,
	KICKS,
	KITS,
	LEADS,
	MAJOR,
	MINOR,
	PLANS,
	QUALITY,
	RHYTHMS,
	SCALES,
	SECOND,
	TEMPOS,
} from '$lib/lounge/station-tables';

/** One tune per slot, in seconds. */
export const SLOT_SEC = 150;
/** Tunes in a row that share a style: a ten-minute set. */
export const SET_SLOTS = 4;
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
export const STYLE_NAMES = {
	lofi: 'Lofi',
	chip: '8-bit',
	ambient: 'Ambient',
} as const;
export type Style = keyof typeof STYLE_NAMES;
export type Section =
	'intro' | 'groove' | 'melody' | 'breakdown' | 'outro' | 'gap';

export interface Chord {
	/** MIDI note of the root, in the bass's octave. */
	bass: number;
	/** The piano's rootless voicing, folded into one comfortable range. */
	notes: number[];
}

/** One thing that sounds in a bar. */
export interface Note {
	part: 'keys' | 'bass' | 'lead' | 'chime' | 'kick' | 'snare' | 'hat' | 'open';
	/** The bar's sixteenth it lands on; swing is the player's. */
	s: number;
	/** MIDI; 0 for a drum. */
	midi: number;
	vel: number;
	/** In sixteenths. */
	len: number;
	/** Seconds late off the grid: a strum, or a hand. */
	nudge: number;
}

export interface Tune {
	slot: number;
	/** Where every bar's own draws start. */
	seed: number;
	name: string;
	style: Style;
	key: number;
	mode: 'major' | 'minor';
	bpm: number;
	barSec: number;
	bars: number;
	/** Four or eight bars, round again. */
	chords: Chord[];
	/** The breakdown's own four bars. */
	bridge: Chord[];
	form: Section[];
	keys: (typeof KEYS_VOICES)[number] | 'pulse';
	lead: (typeof LEADS)[number] | 'pulse';
	bass: (typeof BASSES)[number] | 'tri';
	bassLine: (typeof BASS_LINES)[number] | 'octave';
	kit: (typeof KITS)[number] | 'chip';
	/** The snare on beat three only. */
	halfTime: boolean;
	kicks: number[];
	/** Broken chords in the groove and melody, in place of the comp; null strikes them whole. */
	arp: (number | null)[] | null;
	/** The 8-bit keys' chord tones, one a sixteenth. */
	chipArp: number[];
	/** 0.5 is straight; the eighths lean later the higher it is. */
	swing: number;
	/** Two motifs of two bars in eighths: a step along the scale, or null to ring on. */
	motifs: [(number | null)[], (number | null)[]];
	melodyBase: number;
	/** The tone control wide open, in Hz: darker or brighter tape. */
	open: number;
	/** How loud the vinyl crackles, 0–1. */
	crackle: number;
	/** How much of the room comes back, 0–1. */
	space: number;
	/** Where the blocks start in FILLS and PLANS, so no two blocks of a tune match. */
	turn: number;
}

const cache = new Map<string, Tune>();

/** A set's style: mostly lofi, with 8-bit and ambient sets between. */
export function styleOf(station: string, slot: number): Style {
	const set = Math.floor(slot / SET_SLOTS);
	const x = prng(hashSeed(`${station}:set:${set}`))();
	return x < 0.55 ? 'lofi' : x < 0.8 ? 'chip' : 'ambient';
}

/** The tune a crew's station plays in one slot. */
export function tuneOf(station: string, slot: number): Tune {
	const id = `${station}:${slot}`;
	const known = cache.get(id);
	if (known) return known;
	if (cache.size > 8) cache.clear();
	const seed = hashSeed(id);
	const r = prng(seed);
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
	const other = (n: number, len: number) =>
		(n + 1 + Math.floor(r() * (len - 1))) % len;
	const style = styleOf(station, slot);
	const chip = style === 'chip';
	const calm = style === 'ambient';
	const key = Math.floor(r() * 12);
	const mode = r() < 0.5 ? 'minor' : 'major';
	const bpm = pick(TEMPOS[style]);
	const book = mode === 'minor' ? MINOR : MAJOR;
	const first = Math.floor(r() * book.length);
	const steps = r() < 0.4 ? [...book[first], ...pick(book)] : book[first];
	const voice = ([step, quality]: (typeof book)[number][number]) => {
		const pc = (key + step) % 12;
		const notes = QUALITY[quality]
			.map((iv) => fold(48 + pc + iv, 52, 76))
			.sort((a, b) => a - b);
		return { bass: 36 + pc, notes };
	};
	const rhythms = RHYTHMS[style];
	const ra = Math.floor(r() * rhythms.length);
	// A walk along the scale, mostly by step: a line, not a dice roll.
	const motif = (rhythm: number[]) => {
		let deg = 2 + Math.floor(r() * 3);
		return rhythm.map((on) => {
			if (!on) return null;
			const x = r();
			deg += x < 0.35 ? -1 : x < 0.7 ? 1 : x < 0.85 ? (r() < 0.5 ? -2 : 2) : 0;
			deg = Math.max(-1, Math.min(7, deg));
			return deg;
		});
	};
	const ask = motif(rhythms[ra]);
	const answer = motif(rhythms[other(ra, rhythms.length)]);
	// The answer comes home on the tonic.
	for (let i = answer.length - 1; i >= 0; i--)
		if (answer[i] !== null) {
			answer[i] = answer[i]! > 2 ? 5 : 0;
			break;
		}
	const keys = chip ? 'pulse' : calm ? 'pad' : pick(KEYS_VOICES);
	const barSec = 240 / bpm;
	const tune: Tune = {
		slot,
		seed,
		style,
		key,
		mode,
		bpm,
		barSec,
		bars: Math.floor((SLOT_SEC - 2) / barSec),
		chords: steps.map(voice),
		bridge: book[other(first, book.length)].map(voice),
		form: pick(FORMS),
		keys,
		lead: chip ? 'pulse' : calm ? 'bell' : pick(LEADS),
		bass: chip ? 'tri' : calm ? 'sub' : pick(BASSES),
		bassLine: chip ? 'octave' : calm ? 'sparse' : pick(BASS_LINES),
		kit: chip ? 'chip' : pick(KITS),
		halfTime: r() < 0.25,
		kicks: pick(KICKS),
		arp:
			(keys === 'rhodes' || keys === 'pluck') && r() < 0.35 ? pick(ARPS) : null,
		chipArp: pick(CHIP_ARPS),
		swing: calm ? 0.5 : 0.53 + r() * (chip ? 0.05 : 0.1),
		motifs: [ask, answer],
		melodyBase: key > 6 ? 48 + key : 60 + key,
		open: calm ? 1800 + Math.floor(r() * 800) : 2200 + Math.floor(r() * 2000),
		crackle: calm ? 0.12 : 0.15 + r() * 0.45,
		space: calm ? 0.5 : chip ? 0.12 : 0.22,
		turn: Math.floor(r() * 72),
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

export const drumsIn = (tune: Tune, section: Section) =>
	tune.style !== 'ambient' && (section === 'groove' || section === 'melody');

/** A scale step as semitones over the tonic; steps past the scale climb an octave. */
const degree = (scale: number[], d: number) =>
	scale[((d % scale.length) + scale.length) % scale.length] +
	12 * Math.floor(d / scale.length);

/** The nearest chord tone within a whole step, so a strong beat never rubs. */
function snap(note: number, chord: Chord): number {
	const tones = [chord.bass, ...chord.notes].map((n) => n % 12);
	for (const d of [0, -1, 1, -2, 2])
		if (tones.includes((note + d + 120) % 12)) return note + d;
	return note;
}

/**
 * Everything one bar of a tune plays. Pure: the same tune and bar give the
 * same notes on every screen. The block (eight bars) picks its comp, hats,
 * phrase plan and closing fill; the bar adds ghost notes, pickups and stabs.
 */
export function barNotes(tune: Tune, bar: number): Note[] {
	const section = sectionOf(tune, bar);
	if (section === 'gap') return [];
	const notes: Note[] = [];
	const r = prng(tune.seed ^ Math.imul(bar + 1, 0x9e3779b1));
	const add = (
		part: Note['part'],
		s: number,
		midi: number,
		vel: number,
		len: number,
		nudge = 0,
	) =>
		notes.push({
			part,
			s,
			midi,
			vel: vel * (0.9 + r() * 0.2),
			len,
			nudge: nudge + r() * 0.008,
		});
	const block = Math.floor((bar - 4) / 8);
	const inBlock = (((bar - 4) % 8) + 8) % 8;
	const draws = prng(tune.seed ^ Math.imul(block + 9, 0x85ebca6b));
	const comp = COMPS[Math.floor(draws() * COMPS.length)];
	const hats16 = draws() < 0.3;
	const calm = tune.style === 'ambient';
	const prog = section === 'breakdown' ? tune.bridge : tune.chords;
	// Ambient holds each chord for two bars.
	const step = Math.floor((bar - 4) / (calm ? 2 : 1));
	const at = ((step % prog.length) + prog.length) % prog.length;
	const chord = prog[at];
	const next = prog[(at + 1) % prog.length];
	const busy = section === 'groove' || section === 'melody';

	// Keys.
	if (tune.keys === 'pad') {
		const every = calm ? 2 : 1;
		if (bar % every === 0)
			for (const n of chord.notes) add('keys', 0, n, 1, 16 * every);
	} else if (tune.keys === 'organ') {
		for (const n of chord.notes) add('keys', 0, n, 1, 8);
		if (bar % 2 || r() < 0.3)
			for (const n of chord.notes) add('keys', 8, n, 0.8, 8);
	} else if (tune.keys === 'pulse') {
		const rate = busy ? 1 : 2;
		for (let s = 0; s < 16; s += rate) {
			const tone = tune.chipArp[(s / rate) % tune.chipArp.length];
			const lift = r() < 0.08 ? 12 : 0;
			add(
				'keys',
				s,
				chord.notes[tone % chord.notes.length] + lift,
				s % 4 ? 0.6 : 0.9,
				rate,
			);
		}
	} else if (tune.arp && busy) {
		tune.arp.forEach((tone, e) => {
			if (tone !== null)
				add('keys', e * 2, chord.notes[tone % chord.notes.length], 0.7, 4);
		});
	} else {
		const stabs = new Set(comp);
		if (r() < 0.35) stabs.add(1 + Math.floor(r() * 7));
		for (const e of stabs) {
			const first = e === 0;
			chord.notes.forEach((n, i) =>
				add(
					'keys',
					e * 2,
					n,
					first ? 0.9 : 0.6,
					first ? 15 : 5,
					i * (first ? 0.016 : 0.008),
				),
			);
		}
	}

	// Bass.
	if (section !== 'intro') {
		const line = tune.bassLine;
		if (line === 'sparse') {
			if (!calm || bar % 2 === 0)
				add('bass', 0, chord.bass, calm ? 0.7 : 1, calm ? 30 : 14);
		} else if (line === 'walk') {
			const third = chord.notes[0] % 12;
			const walk = [
				chord.bass,
				chord.bass + ((third - (chord.bass % 12) + 12) % 12),
				chord.bass + 7,
				next.bass + (r() < 0.5 ? -1 : 1),
			];
			walk.forEach((n, i) => add('bass', i * 4, n, i ? 0.75 : 1, 3.6));
		} else if (line === 'octave') {
			for (let e = 0; e < 8; e++)
				add(
					'bass',
					e * 2,
					e === 7 ? next.bass : chord.bass + (e % 2) * 12,
					0.8,
					1.6,
				);
		} else {
			add('bass', 0, chord.bass, 1, 7);
			add('bass', 8, r() < 0.5 ? chord.bass + 7 : chord.bass, 0.8, 5);
			if (r() < 0.4)
				add('bass', 14, next.bass + (r() < 0.5 ? -1 : 2), 0.6, 1.6);
		}
	}

	// The tune's motifs in the block's plan; strong beats land on the chord.
	if (
		section === 'melody' ||
		(calm && section !== 'intro' && section !== 'outro')
	) {
		const plan = PLANS[(block + tune.turn) % PLANS.length];
		const motif = tune.motifs[plan[inBlock >> 1] === 'A' ? 0 : 1];
		const scale = SCALES[tune.mode];
		const from = (inBlock % 2) * 8;
		const varied = inBlock >= 6 && r() < 0.5 ? 1 + Math.floor(r() * 7) : -1;
		for (let e = 0; e < 8; e++) {
			let step = motif[from + e];
			if (step === null) continue;
			if (e === varied) step += r() < 0.5 ? -1 : 1;
			let ring = 1;
			while (
				ring < 4 &&
				from + e + ring < 16 &&
				motif[from + e + ring] === null
			)
				ring++;
			let note = tune.melodyBase + degree(scale, step);
			if (e % 4 === 0) note = snap(note, chord);
			if (note > 81) note -= 12;
			add(calm ? 'chime' : 'lead', e * 2, note, 0.85, ring * 2);
		}
	}
	if (calm && section !== 'intro' && r() < 0.5) {
		const n = chord.notes[Math.floor(r() * chord.notes.length)] + 12;
		add('chime', 2 * Math.floor(r() * 8), n, 0.4, 8);
	}

	// Drums, and the fill that closes every block.
	if (calm) return notes;
	const fill =
		inBlock === 7 && bar >= 4 && section !== 'outro'
			? FILLS[(block + tune.turn) % FILLS.length]
			: null;
	const cut = fill?.cut ?? 16;
	const kicking = busy || (section === 'outro' && bar < tune.bars - 2);
	if (kicking) {
		for (const k of tune.kicks) if (k < cut) add('kick', k, 0, 1, 1);
		if (inBlock % 2 && r() < 0.3 && cut > 13) add('kick', 13, 0, 0.7, 1);
	}
	if (busy) {
		for (const s of tune.halfTime ? [8] : [4, 12])
			if (s < cut) add('snare', s, 0, 0.9, 1);
		if (r() < 0.4) {
			const g = GHOSTS[Math.floor(r() * GHOSTS.length)];
			if (g < cut) add('snare', g, 0, 0.22, 1);
		}
	}
	if (busy || section === 'breakdown') {
		const open = inBlock % 4 === 3 && r() < 0.5 && cut > 14;
		if (open) add('open', 14, 0, 0.7, 1);
		for (let s = 0; s < cut; s += hats16 ? 1 : 2) {
			if ((open && s === 14) || (s && r() < 0.06)) continue;
			add(
				'hat',
				s,
				0,
				s % 4 === 0 ? 0.9 : s % 2 ? 0.35 + r() * 0.2 : 0.55 + r() * 0.3,
				1,
			);
		}
	}
	if (fill) {
		for (const k of fill.kick ?? []) add('kick', k, 0, 0.8, 1);
		(fill.snare ?? []).forEach((s, i) =>
			add('snare', s, 0, 0.35 + i * 0.15, 1),
		);
		for (const s of fill.open ?? []) add('open', s, 0, 0.6, 1);
	}
	return notes;
}

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
