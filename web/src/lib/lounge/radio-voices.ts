/**
 * House radio's instruments: each one a few oscillators or a burst of noise
 * that builds itself, plays once and stops. Levels sit well under 1 on
 * purpose: chords stack five notes and the kick lands on them. This file
 * holds the bass, the leads and the parts every voice is built from; the
 * keys and the drums have files of their own.
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

export const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export function envelope(
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

export function tone(
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

/** A note that swells in over `attack` and holds until it fades over `release`. */
export function swell(
	b: Buses,
	t: number,
	peak: number,
	attack: number,
	hold: number,
	release: number,
	to: AudioNode,
): GainNode {
	const v = b.ctx.createGain();
	v.gain.setValueAtTime(0.0001, t);
	v.gain.linearRampToValueAtTime(peak, t + attack);
	v.gain.setValueAtTime(peak, t + attack + hold);
	v.gain.linearRampToValueAtTime(0.0001, t + attack + hold + release);
	v.connect(to);
	return v;
}

export function lowpass(
	b: Buses,
	freq: number,
	to: AudioNode,
): BiquadFilterNode {
	const f = b.ctx.createBiquadFilter();
	f.type = 'lowpass';
	f.frequency.value = freq;
	f.Q.value = 0.3;
	f.connect(to);
	return f;
}

export function bass(
	b: Buses,
	voice: 'round' | 'sub' | 'upright',
	note: number,
	t: number,
	dur: number,
	vel: number,
) {
	const end = t + dur + 0.1;
	if (voice === 'sub') {
		tone(
			b,
			'sine',
			hz(note),
			t,
			end,
			envelope(b, t, 0.26 * vel, 0.02, dur, b.bass),
		);
		return;
	}
	if (voice === 'upright') {
		// A thumb on a string: quick bloom, short ring.
		const ring = Math.min(dur, 0.45);
		tone(
			b,
			'triangle',
			hz(note),
			t,
			end,
			envelope(b, t, 0.16 * vel, 0.006, ring, b.bass),
		);
		tone(
			b,
			'sine',
			hz(note),
			t,
			end,
			envelope(b, t, 0.14 * vel, 0.006, ring * 1.4, b.bass),
		);
		return;
	}
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

/** The tune's lead in its voice: flute, bell, soft square or whistle. */
export function lead(
	b: Buses,
	voice: 'flute' | 'bell' | 'square' | 'whistle',
	note: number,
	t: number,
	dur: number,
) {
	const f = hz(note);
	const end = t + dur + 1.2;
	if (voice === 'bell') {
		const carrier = tone(
			b,
			'sine',
			f,
			t,
			end,
			envelope(b, t, 0.03, 0.004, 1.1, b.melody),
		);
		const index = b.ctx.createGain();
		index.gain.setValueAtTime(f * 2, t);
		index.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.6);
		index.connect(carrier.frequency);
		tone(b, 'sine', f * 3.5, t, end, index);
		return;
	}
	if (voice === 'square') {
		tone(
			b,
			'square',
			f,
			t,
			t + dur + 0.1,
			lowpass(b, 1300, envelope(b, t, 0.022, 0.02, dur, b.melody)),
		);
		return;
	}
	if (voice === 'whistle') {
		const o = tone(
			b,
			'sine',
			f * 2,
			t,
			t + dur + 0.1,
			envelope(b, t, 0.028, 0.05, dur, b.melody),
		);
		vibrato(b, o, t, dur, t + dur + 0.1);
		return;
	}
	melody(b, note, t, dur);
}

function vibrato(
	b: Buses,
	o: OscillatorNode,
	t: number,
	dur: number,
	end: number,
) {
	const lfo = b.ctx.createOscillator();
	const depth = b.ctx.createGain();
	lfo.frequency.value = 5;
	depth.gain.setValueAtTime(0, t);
	depth.gain.linearRampToValueAtTime(6, t + dur * 0.6);
	lfo.connect(depth);
	depth.connect(o.detune);
	lfo.start(t);
	lfo.stop(end);
}

function melody(b: Buses, note: number, t: number, dur: number) {
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
	vibrato(b, o, t, dur, end);
}
