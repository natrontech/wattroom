import {
	DUCK_ATTACK_MS,
	DUCK_DEFAULT,
	DUCK_HOLD_MS,
	DUCK_RELEASE_MS,
} from '$lib/sound/ducking';
import { glideTo } from '$lib/sound/glide';

/**
 * Session sound design (WATTROOM.md feel layer, #33).
 *
 * Synthesised rather than sampled: synthwave *is* oscillators, filters and
 * envelopes, so there is nothing to license, nothing to download, and a
 * per-room pack becomes a parameter set rather than an asset bundle when that
 * fast-follow arrives.
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
	| 'chat';

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

	leave: {
		id: 'leave',
		label: 'Rider left',
		hint: 'Someone left the room. The join pair, reversed and softer.',
		voices: [
			{ type: 'triangle', freq: note(2), at: 0, dur: 0.09, gain: 0.16 },
			{ type: 'triangle', freq: note(-5), at: 0.09, dur: 0.16, gain: 0.16 },
		],
	},
};

let ctx: AudioContext | undefined;
let master: GainNode | undefined;

/** Volume the cues sit at. They are mixed *under* voice — this is not the headroom. */
let volume = 0.7;
let muted = false;
/** Multiplier applied while someone is speaking, so cues never talk over a person. */
let duck = 1;
/** How hard that dip goes — the mixer's knob (#280); 1 = no ducking at all. */
let duckLevel = DUCK_DEFAULT;
/** The SPEC hold between a voice stopping and the cues coming back up. */
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

/** Where the master belongs right now; every setter converges on it. */
function level(): number {
	return muted ? 0 : volume * duck;
}

/**
 * Moves the master to `level()` over `ms` — 0 acts now, the way a fader must
 * (audit #219). Ducking glides (#675): a cue already sounding when someone
 * starts talking used to take a step in gain, an audible click on the very
 * bus the limiter is there to keep clean, and another one coming back.
 */
function settle(ms: number): void {
	if (!master || !ctx) return;
	if (ms === 0) master.gain.setValueAtTime(level(), ctx.currentTime);
	else glideTo(master.gain, level(), ctx.currentTime, ms);
}

function ensure(): { ctx: AudioContext; master: GainNode } | null {
	if (typeof window === 'undefined') return null;
	if (!ctx) {
		ctx = new AudioContext();
		master = ctx.createGain();
		// A limiter after the master (#152): cues pile up — klaxon, a cheer
		// burst and a block change can land in the same second — and a summed
		// peak past 1.0 hard-clips, which is harsh on laptop speakers and
		// headphones alike. Squash the pileup instead.
		const limiter = ctx.createDynamicsCompressor();
		limiter.threshold.value = -6;
		limiter.knee.value = 4;
		limiter.ratio.value = 12;
		limiter.attack.value = 0.003;
		limiter.release.value = 0.25;
		master.connect(limiter);
		limiter.connect(ctx.destination);
		master.gain.value = level();
	}
	// Browsers start the context suspended until a user gesture; every play attempt retries.
	if (ctx.state === 'suspended') void ctx.resume();
	return { ctx, master: master! };
}

export function setVolume(next: number): void {
	volume = Math.min(1, Math.max(0, next));
	settle(0);
}

export function setMuted(next: boolean): void {
	muted = next;
	settle(0);
}

/**
 * Ride-critical cues still get through; this only pulls them down under a
 * voice — with the SPEC ballistics: attack now, release after a hold, never
 * a snap in either direction (docs/SPEC.md, #152).
 */
export function setDucked(next: boolean): void {
	clearTimeout(releaseTimer);
	if (next) {
		duck = duckLevel;
		settle(DUCK_ATTACK_MS);
		return;
	}
	if (duck === 1) return;
	releaseTimer = setTimeout(() => {
		duck = 1;
		settle(DUCK_RELEASE_MS);
	}, DUCK_HOLD_MS);
}

/**
 * Duck depth, 0 (silence under a voice) … 1 (never duck). Mixer-owned. A knob
 * turned mid-duck re-aims the dip without touching a release already waiting.
 */
export function setDuckLevel(next: number): void {
	duckLevel = Math.min(1, Math.max(0, next));
	if (duck !== 1) {
		duck = duckLevel;
		settle(DUCK_ATTACK_MS);
	}
}

export function play(id: CueId, semitonesUp = 0): void {
	// debug-level so sound issues are diagnosable without ears on the machine
	console.debug('[cue]', id, semitonesUp || '');
	const audio = ensure();
	if (!audio) return;
	const { ctx: context, master: out } = audio;
	const now = context.currentTime + 0.01;
	const shift = Math.pow(2, semitonesUp / 12);

	for (const voice of CUES[id].voices) {
		const osc = context.createOscillator();
		osc.type = voice.type;
		osc.detune.value = voice.detune ?? 0;

		const start = now + voice.at;
		const end = start + voice.dur;
		osc.frequency.setValueAtTime(voice.freq * shift, start);
		if (voice.to)
			osc.frequency.exponentialRampToValueAtTime(voice.to * shift, end);

		let node: AudioNode = osc;

		if (voice.filter) {
			const filter = context.createBiquadFilter();
			filter.type = 'lowpass';
			filter.Q.value = voice.filter.q ?? 1;
			filter.frequency.setValueAtTime(voice.filter.from, start);
			if (voice.filter.to)
				filter.frequency.exponentialRampToValueAtTime(voice.filter.to, end);
			node.connect(filter);
			node = filter;
		}

		const env = context.createGain();
		const peak = voice.gain ?? 0.3;
		// Short attack keeps it percussive; exponential release never reaches 0, so floor it.
		env.gain.setValueAtTime(0.0001, start);
		env.gain.exponentialRampToValueAtTime(peak, start + 0.008);
		env.gain.exponentialRampToValueAtTime(0.0001, end);
		node.connect(env);
		env.connect(out);

		if (voice.wobble) {
			const lfo = context.createOscillator();
			const depth = context.createGain();
			lfo.frequency.value = voice.wobble.rate;
			depth.gain.value = voice.wobble.depth;
			lfo.connect(depth);
			depth.connect(osc.detune);
			lfo.start(start);
			lfo.stop(end);
		}

		osc.start(start);
		osc.stop(end + 0.02);
	}
}

/** 3-2-1 rise up the minor triad so each tick tells you how many are left; 'go' resolves above them. */
const TICK_STEPS: Record<number, number> = { 3: 0, 2: 3, 1: 7 };

export function playCountdownTick(secondsLeft: number): void {
	play('countdown', TICK_STEPS[secondsLeft] ?? 0);
}

/** The full 3-2-1-go sequence, at real cadence. */
export function playCountdown(): void {
	playCountdownTick(3);
	setTimeout(() => playCountdownTick(2), 1000);
	setTimeout(() => playCountdownTick(1), 2000);
	setTimeout(() => play('go'), 3000);
}
