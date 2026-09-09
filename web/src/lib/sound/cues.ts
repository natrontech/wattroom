import { ducking, onDuck } from '$lib/sound/duck';
import { DUCK_ATTACK_MS, DUCK_DEFAULT } from '$lib/sound/ducking';
import { CUES, type CueId } from '$lib/sound/cue-catalogue';
import { glideTo } from '$lib/sound/glide';

/**
 * Session sound design (WATTROOM.md feel layer, #33).
 *
 * Synthesised rather than sampled: synthwave *is* oscillators, filters and
 * envelopes, so there is nothing to license, nothing to download, and a
 * per-room pack becomes a parameter set rather than an asset bundle when that
 * fast-follow arrives.
 *
 * This is the engine: one AudioContext, the master under the mixer's
 * volume and the duck, and `play`. What each cue sounds like is the
 * catalogue in cue-catalogue.ts.
 */

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
/** Shared with the soundboard (#877) — see `bus()`. */
let limiter: DynamicsCompressorNode | undefined;

/** Volume the cues sit at. They are mixed *under* voice — this is not the headroom. */
let volume = 0.7;
let muted = false;
/** Multiplier applied while someone is speaking, so cues never talk over a person. */
let duck = 1;
/** How hard that dip goes — the mixer's knob (#280); 1 = no ducking at all. */
let duckLevel = DUCK_DEFAULT;

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

/**
 * Resume a context the browser started suspended. Registered on the first
 * gesture of either kind and removed once it takes (#1681).
 *
 * `ensure` already asks on every play, but a refused `resume()` is never
 * retried — and the ask arrives a tick after the press, inside a WebSocket
 * message rather than the gesture. Nothing was listening for a KEY at all,
 * which is the board's whole pitch: hitting a pad without looking. So a rider
 * who had not happened to click anything heard nothing — their own clip or
 * anyone else's — until they opened the panel, which is a click.
 */
function unlock(): void {
	if (!ctx) return;
	if (ctx.state !== 'running') {
		void ctx.resume();
		return;
	}
	document.removeEventListener('pointerdown', unlock);
	document.removeEventListener('keydown', unlock);
}

function ensure(): { ctx: AudioContext; master: GainNode } | null {
	if (typeof window === 'undefined') return null;
	if (!ctx) {
		ctx = new AudioContext();
		// Only once something has asked for sound: a page that never makes one
		// gets no listeners and no context to resume.
		document.addEventListener('pointerdown', unlock);
		document.addEventListener('keydown', unlock);
		master = ctx.createGain();
		// A limiter after the master (#152): cues pile up — klaxon, a cheer
		// burst and a block change can land in the same second — and a summed
		// peak past 1.0 hard-clips, which is harsh on laptop speakers and
		// headphones alike. Squash the pileup instead.
		limiter = ctx.createDynamicsCompressor();
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

/**
 * The bus a channel other than the cues plugs into (#877, ADR-0033). The
 * soundboard needs a fader of its own, never the cue fader — but it wants the
 * same limiter, because an airhorn and a klaxon landing in the same second is
 * exactly the pileup that limiter exists for. One context, two channels.
 */
export function bus(): { ctx: AudioContext; input: AudioNode } | null {
	const audio = ensure();
	if (!audio || !limiter) return null;
	return { ctx: audio.ctx, input: limiter };
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
 * voice. The attack, the hold and the release are the duck controller's
 * (`duck.ts`, #988) — this only applies what it is told, at the moment the
 * jukebox is told the same thing, so a rider hears one duck rather than two
 * a few tens of milliseconds apart.
 */
onDuck(({ down, ms }) => {
	duck = down ? duckLevel : 1;
	settle(ms);
});

/**
 * Duck depth, 0 (silence under a voice) … 1 (never duck). Mixer-owned. A knob
 * turned mid-duck re-aims the dip without touching a release already waiting.
 */
export function setDuckLevel(next: number): void {
	duckLevel = Math.min(1, Math.max(0, next));
	if (ducking()) {
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
