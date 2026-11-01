/** House radio's keys: what plays the chords, struck, held or plucked. */
import {
	envelope,
	hz,
	lowpass,
	swell,
	tone,
	type Buses,
} from '$lib/lounge/radio-voices';

/** Electric piano: one FM pair whose bell of an attack settles to a round tone. */
export function piano(
	b: Buses,
	note: number,
	t: number,
	vel: number,
	dur: number,
) {
	const f = hz(note);
	const end = t + dur + 0.1;
	const carrier = tone(
		b,
		'sine',
		f,
		t,
		end,
		envelope(b, t, 0.035 * vel, 0.008, dur, b.keys),
	);
	const index = b.ctx.createGain();
	index.gain.setValueAtTime(f * 1.4 * vel, t);
	index.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.45);
	index.connect(carrier.frequency);
	tone(b, 'sine', f, t, end, index);
}

/** Warm pad: two detuned saws behind a low-pass that opens across the bar. */
export function pad(b: Buses, note: number, t: number, dur: number) {
	const end = t + dur + 0.8;
	const filter = lowpass(
		b,
		380,
		swell(b, t, 0.011, 0.4, Math.max(0, dur - 0.4), 0.7, b.keys),
	);
	filter.frequency.setValueAtTime(380, t);
	filter.frequency.linearRampToValueAtTime(1300, t + dur * 0.6);
	for (const cents of [-8, 8])
		tone(b, 'sawtooth', hz(note), t, end, filter).detune.value = cents;
}

/** Drawbar organ: three harmonics, a soft click of an attack, held. */
export function organ(b: Buses, note: number, t: number, dur: number) {
	const end = t + dur + 0.2;
	[1, 2, 3].forEach((harmonic, i) =>
		tone(
			b,
			'sine',
			hz(note) * harmonic,
			t,
			end,
			swell(b, t, 0.01 / (i + 1), 0.015, dur, 0.15, b.keys),
		),
	);
}

/** A plucked string: bright for an instant, gone in a beat. */
export function pluck(b: Buses, note: number, t: number, vel: number) {
	const filter = lowpass(
		b,
		2400,
		envelope(b, t, 0.05 * vel, 0.003, 0.45, b.keys),
	);
	filter.frequency.setValueAtTime(2400, t);
	filter.frequency.exponentialRampToValueAtTime(500, t + 0.3);
	tone(b, 'triangle', hz(note), t, t + 0.55, filter);
	tone(
		b,
		'sawtooth',
		hz(note),
		t,
		t + 0.55,
		envelope(b, t, 0.006 * vel, 0.003, 0.12, filter),
	);
}
