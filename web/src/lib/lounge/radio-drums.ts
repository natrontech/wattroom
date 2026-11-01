/** House radio's drums: three kits from one kick, filtered noise and a click. */
import { envelope, tone, type Buses } from '$lib/lounge/radio-voices';

function hiss(
	b: Buses,
	t: number,
	type: BiquadFilterType,
	freq: number,
	peak: number,
	decay: number,
) {
	const s = b.ctx.createBufferSource();
	s.buffer = b.noise;
	const filter = b.ctx.createBiquadFilter();
	filter.type = type;
	filter.frequency.value = freq;
	filter.Q.value = 0.7;
	s.connect(filter);
	filter.connect(envelope(b, t, peak, 0.002, decay, b.drums));
	s.start(t, (t * 7.3) % 0.5);
	s.stop(t + decay + 0.05);
}

export function kick(b: Buses, t: number, vel = 1) {
	const o = tone(
		b,
		'sine',
		110,
		t,
		t + 0.4,
		envelope(b, t, 0.5 * vel, 0.004, 0.32, b.drums),
	);
	o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
	hiss(b, t, 'highpass', 3000, 0.03, 0.006);
	const g = b.duck.gain;
	g.cancelScheduledValues(t);
	g.setValueAtTime(1, t);
	g.linearRampToValueAtTime(0.8, t + 0.015);
	g.linearRampToValueAtTime(1, t + 0.25);
}

export function snare(b: Buses, t: number, vel: number) {
	hiss(b, t, 'bandpass', 1800, 0.15 * vel, 0.16);
	tone(
		b,
		'triangle',
		185,
		t,
		t + 0.12,
		envelope(b, t, 0.05 * vel, 0.002, 0.07, b.drums),
	);
}

/** A brush across the snare: a long soft swish rather than a crack. */
export function brush(b: Buses, t: number, vel: number) {
	hiss(b, t, 'bandpass', 2600, 0.07 * vel, 0.28);
}

/** A cross-stick: a short wooden click. */
export function rim(b: Buses, t: number, vel: number) {
	hiss(b, t, 'bandpass', 3200, 0.06 * vel, 0.03);
	tone(
		b,
		'triangle',
		420,
		t,
		t + 0.06,
		envelope(b, t, 0.06 * vel, 0.001, 0.04, b.drums),
	);
}

export function hat(b: Buses, t: number, vel: number, open: boolean) {
	hiss(b, t, 'highpass', 7500, 0.028 * vel, open ? 0.22 : 0.032);
}
