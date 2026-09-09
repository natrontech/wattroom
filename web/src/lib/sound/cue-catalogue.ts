/**
 * What each cue sounds like (WATTROOM.md feel layer, #33): the voices —
 * oscillator, sweep, envelope, filter — per cue id. Data only; cues.ts is
 * the engine that plays it. Split for size (code-quality.md).
 */

export interface Voice {
	type: OscillatorType;
	/** start frequency in Hz */
	freq: number;
	/** sweep to this frequency across the voice's life */
	to?: number;
	/** offset from cue start, seconds */
	at: number;
	dur: number;
	/** peak gain before the master mix, 0–1 */
	gain?: number;
	/** cents; a little detune is what stops a square wave sounding like a phone */
	detune?: number;
	/** lowpass sweep — the single most synthwave-sounding thing available */
	filter?: { from: number; to?: number; q?: number };
	/** pitch wobble, for klaxons */
	wobble?: { rate: number; depth: number };
}

export interface Cue {
	id: CueId;
	label: string;
	hint: string;
	voices: Voice[];
}

export type CueId =
	| 'countdown'
	| 'go'
	| 'poke'
	| 'klaxon'
	| 'elimination'
	| 'fanfare'
	| 'cheer'
	| 'reaction'
	| 'block'
	| 'join'
	| 'leave'
	| 'chat'
	| 'fault'
	| 'recover'
	| 'handoff';

/** A minor triad reads as tension, a major one as reward — the whole emotional vocabulary. */
const A4 = 440;
const note = (semitonesFromA4: number) =>
	A4 * Math.pow(2, semitonesFromA4 / 12);

export const CUES: Record<CueId, Cue> = {
	countdown: {
		id: 'countdown',
		label: 'Countdown tick',
		hint: 'Each of the last three seconds before a session starts — rising as zero approaches.',
		voices: [
			{
				type: 'square',
				freq: note(4),
				at: 0,
				dur: 0.09,
				gain: 0.5,
				detune: 6,
				filter: { from: 2600, to: 1400 },
			},
		],
	},

	go: {
		id: 'go',
		label: 'Go',
		hint: 'Zero. Higher and longer than the ticks, so it is unmistakably the last one.',
		voices: [
			{
				type: 'square',
				freq: note(11),
				at: 0,
				dur: 0.28,
				gain: 0.55,
				detune: 8,
				filter: { from: 3800, to: 1600 },
			},
			{
				type: 'sawtooth',
				freq: note(-1),
				at: 0,
				dur: 0.34,
				gain: 0.24,
				filter: { from: 900 },
			},
		],
	},

	poke: {
		id: 'poke',
		label: 'Poke',
		hint: 'One rider is asking for your attention. Clearer than presence, gentler than the sprint klaxon.',
		voices: [
			{ type: 'triangle', freq: note(2), at: 0, dur: 0.12, gain: 0.28 },
			{ type: 'triangle', freq: note(9), at: 0.14, dur: 0.12, gain: 0.3 },
			{ type: 'square', freq: note(14), at: 0.28, dur: 0.22, gain: 0.2 },
		],
	},

	klaxon: {
		id: 'klaxon',
		label: 'Sprint klaxon',
		hint: 'Three seconds before a sprint window opens. The one cue allowed to be rude.',
		voices: [
			{
				type: 'sawtooth',
				freq: 196,
				at: 0,
				dur: 0.85,
				gain: 0.42,
				detune: -9,
				wobble: { rate: 7, depth: 14 },
				filter: { from: 700, to: 2600, q: 6 },
			},
			{
				type: 'sawtooth',
				freq: 262,
				at: 0.04,
				dur: 0.8,
				gain: 0.34,
				detune: 11,
				wobble: { rate: 7, depth: 14 },
				filter: { from: 800, to: 2400, q: 6 },
			},
		],
	},

	elimination: {
		id: 'elimination',
		label: 'Elimination sting',
		hint: "You're out of a Backyard round, or you burned your last life.",
		voices: [
			{
				type: 'sawtooth',
				freq: note(3),
				to: note(-9),
				at: 0,
				dur: 0.55,
				gain: 0.4,
				filter: { from: 2200, to: 380, q: 3 },
			},
			{
				type: 'square',
				freq: note(-9),
				to: note(-21),
				at: 0.1,
				dur: 0.5,
				gain: 0.2,
				filter: { from: 1200, to: 260 },
			},
		],
	},

	fanfare: {
		id: 'fanfare',
		label: 'Medal fanfare',
		hint: 'A medal, or a category promotion. SPEC: promotions announce, demotions stay silent.',
		voices: [
			{
				type: 'square',
				freq: note(0),
				at: 0,
				dur: 0.16,
				gain: 0.34,
				detune: 5,
			},
			{
				type: 'square',
				freq: note(4),
				at: 0.11,
				dur: 0.16,
				gain: 0.34,
				detune: 5,
			},
			{
				type: 'square',
				freq: note(7),
				at: 0.22,
				dur: 0.16,
				gain: 0.34,
				detune: 5,
			},
			{
				type: 'square',
				freq: note(12),
				at: 0.33,
				dur: 0.5,
				gain: 0.4,
				detune: 5,
				filter: { from: 4200, to: 1800 },
			},
			{
				type: 'sawtooth',
				freq: note(-12),
				at: 0.33,
				dur: 0.55,
				gain: 0.2,
				filter: { from: 800 },
			},
		],
	},

	cheer: {
		id: 'cheer',
		label: 'Cheer',
		hint: "A spectator's cheer landing on your dashboard. Deliberately tiny — these arrive in bursts.",
		voices: [
			{
				type: 'sine',
				freq: note(7),
				to: note(16),
				at: 0,
				dur: 0.14,
				gain: 0.3,
			},
		],
	},

	reaction: {
		id: 'reaction',
		label: 'Rider reaction',
		hint: 'A flame or a skull from someone too gassed to talk. Softer than a cheer — it comes from inside the room.',
		voices: [
			{
				type: 'triangle',
				freq: note(12),
				to: note(16),
				at: 0,
				dur: 0.1,
				gain: 0.22,
			},
		],
	},

	block: {
		id: 'block',
		label: 'Block change',
		hint: 'Not in WATTROOM.md — proposed. The target just changed and you are not looking at the screen.',
		voices: [
			{ type: 'triangle', freq: note(0), at: 0, dur: 0.11, gain: 0.26 },
			{ type: 'triangle', freq: note(7), at: 0.1, dur: 0.18, gain: 0.26 },
		],
	},

	// Presence pair (#148): quiet chrome, not a klaxon. Rising = someone
	// arrived, falling = someone left — distinguishable without looking.
	join: {
		id: 'join',
		label: 'Rider joined',
		hint: 'Someone arrived in the room. Two soft rising notes.',
		voices: [
			{ type: 'triangle', freq: note(-5), at: 0, dur: 0.09, gain: 0.18 },
			{ type: 'triangle', freq: note(2), at: 0.09, dur: 0.16, gain: 0.2 },
		],
	},

	leave: {
		id: 'leave',
		label: 'Rider left',
		hint: 'Someone left the room. The join pair, reversed and softer.',
		voices: [
			{ type: 'triangle', freq: note(2), at: 0, dur: 0.09, gain: 0.16 },
			{ type: 'triangle', freq: note(-5), at: 0.09, dur: 0.16, gain: 0.16 },
		],
	},

	chat: {
		id: 'chat',
		label: 'Chat message',
		hint: 'A line landed in the room chat. Quieter than a cheer — words wait.',
		voices: [
			{
				type: 'sine',
				freq: note(9),
				to: note(14),
				at: 0,
				dur: 0.07,
				gain: 0.16,
			},
			{ type: 'sine', freq: note(14), at: 0.07, dur: 0.09, gain: 0.13 },
		],
	},

	// Team Relay's handover (#845): you are on front now, at 110 % FTP.
	// Deliberately not the klaxon — that one is allowed to be rude because a
	// sprint happens once; a relay rotates every 60–90 s, and the pack's own
	// rule is that nothing repetitive survives an hour. Two notes up a fourth
	// and a filter opening: directive, over in a quarter second.
	handoff: {
		id: 'handoff',
		label: 'You are on front',
		hint: 'Team Relay handed you the front. Go to the target now — clear without being the klaxon, because this comes round every minute.',
		voices: [
			{
				type: 'square',
				freq: note(2),
				at: 0,
				dur: 0.1,
				gain: 0.3,
				detune: 5,
				filter: { from: 1600, to: 2600 },
			},
			{
				type: 'square',
				freq: note(7),
				at: 0.1,
				dur: 0.2,
				gain: 0.34,
				detune: 5,
				filter: { from: 2200, to: 3400 },
			},
		],
	},

	// The fault pair (#834): a banner is the wrong channel on its own — the
	// rider is three metres away, sweating, not reading. Falling = something
	// broke, rising = it came back, and neither is allowed to sound like the
	// sprint klaxon, which means "go", not "stop".
	fault: {
		id: 'fault',
		label: 'Something broke',
		hint: 'A trainer, the room, voice or the mic dropped — or an action failed. Two falling notes, urgent but not the klaxon.',
		voices: [
			{
				type: 'triangle',
				freq: note(-2),
				at: 0,
				dur: 0.13,
				gain: 0.3,
				filter: { from: 1800, to: 900 },
			},
			{
				type: 'triangle',
				freq: note(-9),
				at: 0.13,
				dur: 0.26,
				gain: 0.32,
				detune: -7,
				filter: { from: 1400, to: 500 },
			},
		],
	},

	recover: {
		id: 'recover',
		label: 'Back online',
		hint: 'The fault cleared itself. The fault pair inverted and resolved a fifth up, so the ear hears an answer.',
		voices: [
			{
				type: 'triangle',
				freq: note(-9),
				at: 0,
				dur: 0.11,
				gain: 0.24,
				filter: { from: 900, to: 1600 },
			},
			{
				type: 'triangle',
				freq: note(-2),
				at: 0.1,
				dur: 0.22,
				gain: 0.26,
				filter: { from: 1200, to: 2400 },
			},
		],
	},
};
