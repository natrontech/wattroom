/**
 * House radio's 8-bit voices: pulse waves, a triangle bass and noise drums,
 * played through the same tape and tone control as the lofi kit.
 */
import {
	envelope,
	hz,
	tone,
	vibrato,
	type Buses,
} from '#lib/lounge/radio-voices.ts';
import { hiss, pump } from '#lib/lounge/radio-drums.ts';

const waves = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>();

/** A pulse of `duty`: 0.5 is a square, 0.25 and 0.125 grow thinner. */
function wave(ctx: BaseAudioContext, duty: number): PeriodicWave {
	let byDuty = waves.get(ctx);
	if (!byDuty) waves.set(ctx, (byDuty = new Map()));
	let w = byDuty.get(duty);
	if (!w) {
		const real = new Float32Array(48);
		for (let n = 1; n < 48; n++)
			real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
		w = ctx.createPeriodicWave(real, new Float32Array(48));
		byDuty.set(duty, w);
	}
	return w;
}

export function pulse(
	b: Buses,
	note: number,
	t: number,
	dur: number,
	peak: number,
	duty: number,
	to: AudioNode,
): OscillatorNode {
	const o = b.ctx.createOscillator();
	o.setPeriodicWave(wave(b.ctx, duty));
	o.frequency.value = hz(note);
	o.connect(envelope(b, t, peak, 0.003, dur, to));
	o.start(t);
	o.stop(t + dur + 0.05);
	return o;
}

/** The lead: a thin pulse that sings with a late vibrato. */
export function chipLead(
	b: Buses,
	note: number,
	t: number,
	dur: number,
	vel: number,
) {
	const o = pulse(b, note, t, dur, 0.026 * vel, 0.125, b.melody);
	vibrato(b, o, t, dur, t + dur + 0.05);
}

export function chipBass(
	b: Buses,
	note: number,
	t: number,
	dur: number,
	vel: number,
) {
	tone(
		b,
		'triangle',
		hz(note),
		t,
		t + dur + 0.05,
		envelope(b, t, 0.3 * vel, 0.004, dur, b.bass),
	);
}

export function chipKick(b: Buses, t: number, vel: number) {
	const o = tone(
		b,
		'triangle',
		160,
		t,
		t + 0.2,
		envelope(b, t, 0.55 * vel, 0.002, 0.14, b.drums),
	);
	o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
	pump(b, t);
}

export function chipSnare(b: Buses, t: number, vel: number) {
	hiss(b, t, 'highpass', 1200, 0.14 * vel, 0.09);
}

export function chipHat(b: Buses, t: number, vel: number, open: boolean) {
	hiss(b, t, 'highpass', 9000, 0.04 * vel, open ? 0.12 : 0.018);
}
