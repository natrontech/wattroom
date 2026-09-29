import type { NoiseVoice, Voice } from './cue-catalogue';

/**
 * The nodes a cue and a master are made of (#152, #3353). Both functions
 * are self-contained — no imports, no module state — because
 * e2e/mix.spec.ts loads these very functions into a page by their source and
 * renders them offline: what it measures is what plays.
 */

/**
 * The limiter a master ends in, wired into `destination`; returns its input.
 * Cues pile up — a klaxon, a cheer burst and a block change can land in the
 * same second — and a summed peak past 1.0 hard-clips, which is harsh on
 * laptop speakers and headphones alike. The cue and board bus ends in one
 * (cues.ts), and so does the voice bus (av-output.ts), where faders reach ×2.
 *
 * Two stages. The compressor squashes the pileup. Its 3 ms attack lets an
 * onset through, though: every cue at once with the loudest board clip
 * peaked at +0.84 dBFS (#3353). The brickwall after it holds the ceiling —
 * ratio 20 from −1 dBFS, no knee, no attack — and a trim takes back the
 * makeup gain Web Audio gives every compressor, (1 ÷ its gain at 0 dBFS)^0.6,
 * so nothing under the ceiling changes at all.
 */
export function makeLimiter(
	context: BaseAudioContext,
	destination: AudioNode,
): AudioNode {
	const squash = context.createDynamicsCompressor();
	squash.threshold.value = -6;
	squash.knee.value = 4;
	squash.ratio.value = 12;
	squash.attack.value = 0.003;
	squash.release.value = 0.25;

	const ceiling = -1;
	const ratio = 20;
	const brick = context.createDynamicsCompressor();
	brick.threshold.value = ceiling;
	brick.knee.value = 0;
	brick.ratio.value = ratio;
	brick.attack.value = 0;
	brick.release.value = 0.05;
	const trim = context.createGain();
	trim.gain.value = 10 ** ((0.6 * ceiling * (1 - 1 / ratio)) / 20);

	squash.connect(brick);
	brick.connect(trim);
	trim.connect(destination);
	return squash;
}

/** A second of white noise: a shutter's click has no pitch. Its caller keeps it. */
export function makeNoise(context: BaseAudioContext): AudioBuffer {
	const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
	const samples = noise.getChannelData(0);
	for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
	return noise;
}

/**
 * One cue's voices onto `out`, starting at `now`, every pitch times `shift`.
 * `noise` is asked for only by a noise voice.
 */
export function scheduleVoices(
	context: BaseAudioContext,
	out: AudioNode,
	voices: readonly (Voice | NoiseVoice)[],
	now: number,
	shift: number,
	noise: () => AudioBuffer,
): void {
	for (const voice of voices) {
		const start = now + voice.at;
		const end = start + voice.dur;
		let source: AudioScheduledSourceNode;
		if (voice.type === 'noise') {
			const click = context.createBufferSource();
			click.buffer = noise();
			source = click;
		} else {
			const osc = context.createOscillator();
			osc.type = voice.type;
			osc.detune.value = voice.detune ?? 0;
			osc.frequency.setValueAtTime(voice.freq * shift, start);
			if (voice.to)
				osc.frequency.exponentialRampToValueAtTime(voice.to * shift, end);
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
			source = osc;
		}

		let node: AudioNode = source;

		if (voice.filter) {
			const filter = context.createBiquadFilter();
			filter.type = voice.filter.type ?? 'lowpass';
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

		source.start(start);
		source.stop(end + 0.02);
	}
}
