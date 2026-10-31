/**
 * House radio's instruments: each one a few oscillators or a burst of noise
 * that builds itself, plays once and stops. Levels sit well under 1 on
 * purpose: chords stack five notes and the kick lands on them.
 */

/** Where the voices play into, built once by house-radio.ts. */
export interface Buses {
	ctx: AudioContext;
	noise: AudioBuffer;
	keys: AudioNode;
	bass: AudioNode;
	melody: AudioNode;
	drums: AudioNode;
	/** The sidechain: dips the keys and bass on every kick. */
	duck: GainNode;
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

function envelope(
	b: Buses,
	t: number,
	peak: number,
	attack: number,
	decay: number,
	to: AudioNode,
): GainNode {
	const v = b.ctx.createGain();
	v.gain.setValueAtTime(0.0001, t);
	v.gain.exponentialRampToValueAtTime(peak, t + attack);
	v.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
	v.connect(to);
	return v;
}

function tone(
	b: Buses,
	type: OscillatorType,
	freq: number,
	t: number,
	end: number,
	to: AudioNode,
): OscillatorNode {
	const o = b.ctx.createOscillator();
	o.type = type;
	o.frequency.value = freq;
	o.connect(to);
	o.start(t);
	o.stop(end);
	return o;
}

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

export function bass(
	b: Buses,
	note: number,
	t: number,
	dur: number,
	vel: number,
) {
	const end = t + dur + 0.1;
	tone(
		b,
		'sine',
		hz(note),
		t,
		end,
		envelope(b, t, 0.22 * vel, 0.015, dur, b.bass),
	);
	tone(
		b,
		'triangle',
		hz(note),
		t,
		end,
		envelope(b, t, 0.05 * vel, 0.015, dur, b.bass),
	);
}

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

export function kick(b: Buses, t: number) {
	const o = tone(
		b,
		'sine',
		110,
		t,
		t + 0.4,
		envelope(b, t, 0.5, 0.004, 0.32, b.drums),
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

export function hat(b: Buses, t: number, vel: number, open: boolean) {
	hiss(b, t, 'highpass', 7500, 0.028 * vel, open ? 0.22 : 0.032);
}

export function melody(b: Buses, note: number, t: number, dur: number) {
	const end = t + dur + 0.1;
	const o = tone(
		b,
		'triangle',
		hz(note),
		t,
		end,
		envelope(b, t, 0.035, 0.03, dur, b.melody),
	);
	tone(
		b,
		'sine',
		hz(note) * 2,
		t,
		end,
		envelope(b, t, 0.008, 0.03, dur * 0.6, b.melody),
	);
	const vibrato = b.ctx.createOscillator();
	const depth = b.ctx.createGain();
	vibrato.frequency.value = 5;
	depth.gain.setValueAtTime(0, t);
	depth.gain.linearRampToValueAtTime(6, t + dur * 0.6);
	vibrato.connect(depth);
	depth.connect(o.detune);
	vibrato.start(t);
	vibrato.stop(end);
}
