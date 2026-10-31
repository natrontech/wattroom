/**
 * House radio's mixing desk: the buses its voices play into, the tone and
 * tape that make it lofi, and the mixer's fader last of all.
 */
import type { Buses } from '$lib/lounge/radio-voices';

/** The tone control wide open; house-radio.ts closes it for a breakdown. */
export const OPEN_HZ = 3200;

export interface Graph extends Buses {
	level: GainNode;
	master: GainNode;
	tuneGain: GainNode;
	toneFilter: BiquadFilterNode;
	echo: DelayNode;
	rain: GainNode;
}

export function build(ctx: AudioContext): Graph {
	const buffer = (sec: number, fill: (i: number, n: number) => number) => {
		const b = ctx.createBuffer(
			2,
			Math.floor(ctx.sampleRate * sec),
			ctx.sampleRate,
		);
		for (let ch = 0; ch < 2; ch++) {
			const d = b.getChannelData(ch);
			for (let i = 0; i < d.length; i++) d[i] = fill(i, d.length);
		}
		return b;
	};
	const gain = (v: number, to?: AudioNode) => {
		const g = ctx.createGain();
		g.gain.value = v;
		if (to) g.connect(to);
		return g;
	};
	const filter = (type: BiquadFilterType, f: number, to?: AudioNode) => {
		const n = ctx.createBiquadFilter();
		n.type = type;
		n.frequency.value = f;
		n.Q.value = 0.4;
		if (to) n.connect(to);
		return n;
	};
	const lfo = (rate: number, depth: number, param: AudioParam) => {
		const o = ctx.createOscillator();
		o.frequency.value = rate;
		o.connect(gain(depth, undefined)).connect(param);
		o.start();
	};
	const loop = (b: AudioBuffer, to: AudioNode) => {
		const s = ctx.createBufferSource();
		s.buffer = b;
		s.loop = true;
		s.connect(to);
		s.start();
	};

	// The mixer's fader and duck, last, so they scale what the rider hears.
	const level = gain(0, ctx.destination);
	const comp = ctx.createDynamicsCompressor();
	comp.threshold.value = -20;
	comp.knee.value = 12;
	comp.ratio.value = 2;
	comp.connect(level);
	const master = gain(0.45, comp);
	const tuneGain = gain(1, master);
	const toneFilter = filter('lowpass', OPEN_HZ, tuneGain);
	const wow = ctx.createDelay(0.05);
	wow.delayTime.value = 0.006;
	wow.connect(toneFilter);
	lfo(0.33, 0.001, wow.delayTime);
	const pre = gain(1, wow);

	const verb = ctx.createConvolver();
	verb.buffer = buffer(
		2.6,
		(i, n) => (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3),
	);
	verb.connect(gain(0.22, pre));
	const drums = gain(0.6, pre);
	const duck = gain(1, pre);
	const trem = gain(0.88, duck);
	trem.connect(gain(0.4, verb));
	lfo(4.2, 0.08, trem.gain);
	const keys = gain(1, trem);
	const bassBus = gain(1, filter('lowpass', 520, duck));
	const melodyBus = gain(1, pre);
	melodyBus.connect(gain(0.5, verb));
	const echo = ctx.createDelay(2);
	const echoTone = filter('lowpass', 2200);
	melodyBus.connect(echo);
	echo.connect(echoTone);
	echoTone.connect(gain(0.3, echo));
	echoTone.connect(gain(0.3, pre));

	loop(
		buffer(
			3,
			() =>
				(Math.random() * 2 - 1) * 0.002 +
				(Math.random() < 0.0003 ? (Math.random() - 0.5) * 0.25 : 0),
		),
		gain(0.35, master),
	);
	let brown = 0;
	const rain = gain(0, master);
	loop(
		buffer(4, () => {
			brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
			return brown * 3.5;
		}),
		filter('lowpass', 1600, rain),
	);
	return {
		ctx,
		noise: buffer(1, () => Math.random() * 2 - 1),
		keys,
		bass: bassBus,
		melody: melodyBus,
		drums,
		duck,
		level,
		master,
		tuneGain,
		toneFilter,
		echo,
		rain,
	};
}
