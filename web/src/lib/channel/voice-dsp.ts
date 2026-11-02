/**
 * The transmit path's audio-thread half: a lookahead, the light noise
 * suppression and the gate, sample by sample.
 *
 * The gate used to decide on the main thread. The worklet posted a level every
 * 20 ms, a busy main thread (video tiles, the jukebox, the ride world) handled
 * it when it could, and only then did the gain begin its 5 ms ramp. Every
 * sentence after a pause lost its first 20 to 60 ms: the soft consonant that
 * starts it ("h", "s", "f"), which is most of what makes speech sound clear.
 * Here the decision and the gain run on the same sample, and the audio itself
 * is held back by LOOKAHEAD samples, so the gate is already open when the
 * first sound of a word leaves the machine.
 *
 * Self-contained, no imports and no module state, because `mic-level.ts` ships
 * it into the AudioWorklet by its source. The test runs this very function.
 */

export interface VoiceDspOptions {
	sampleRate: number;
	envAttackMs: number;
	envReleaseMs: number;
	gateAttackMs: number;
	gateReleaseMs: number;
	holdMs: number;
	/** How far under the open mark the level may fall and still hold it. */
	closeDb: number;
	/** The automatic threshold sits this far over the measured noise floor. */
	autoMarginDb: number;
	autoMin: number;
	autoMax: number;
	/** The floor is the quietest envelope over this long. */
	floorWindowMs: number;
	/** The most the noise suppression takes off any frequency, in dB (negative). */
	nsFloorDb: number;
}

export interface VoiceDspParams {
	/** The gate's mark when not automatic (RMS 0..1). */
	threshold: number;
	auto: boolean;
	ns: boolean;
	/** Push-to-talk and a closed call decide, not the level. */
	force: 'open' | 'shut' | null;
}

/** Audio is held back this many samples: one noise-suppression frame. */
export const LOOKAHEAD = 512;

export function createVoiceDsp(o: VoiceDspOptions) {
	const N = 512;
	const HOP = N / 2;
	const sr = o.sampleRate;

	const params = { threshold: 0.02, auto: true, ns: false, force: null } as {
		threshold: number;
		auto: boolean;
		ns: boolean;
		force: 'open' | 'shut' | null;
	};

	// --- level, floor, gate
	let env = 0;
	let open = false;
	let loudAt = -Infinity;
	let gain = 0;
	let now = 0; // ms of audio processed
	const margin = Math.pow(10, o.autoMarginDb / 20);
	const holdRatio = Math.pow(10, -o.closeDb / 20);
	const prior = o.autoMin / margin;
	const buckets = Math.max(1, Math.round(o.floorWindowMs / 1000));
	const past: number[] = [];
	for (let i = 0; i < buckets - 1; i++) past.push(prior);
	let bucketMin = prior;
	let bucketAt = 0;
	let floor = prior;
	const upStep = 1 / ((o.gateAttackMs * sr) / 1000);
	const downStep = 1 / ((o.gateReleaseMs * sr) / 1000);

	function mark() {
		if (!params.auto) return params.threshold;
		return Math.min(o.autoMax, Math.max(o.autoMin, floor * margin));
	}

	function judge(block: Float32Array) {
		let sum = 0;
		for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
		const rms = Math.sqrt(sum / block.length);
		const dt = (block.length / sr) * 1000;
		const tau = rms > env ? o.envAttackMs : o.envReleaseMs;
		env = rms + (env - rms) * Math.exp(-dt / tau);
		now += dt;

		// Minimum statistics: the quietest moment of each second, and the
		// quietest of the last few seconds is the room. A sentence has pauses
		// in it, so speech never holds the floor up; a fan that starts is
		// measured within the window.
		bucketMin = Math.min(bucketMin, env);
		if (now - bucketAt >= 1000) {
			past.push(bucketMin);
			if (past.length > buckets - 1) past.shift();
			bucketMin = env;
			bucketAt = now;
		}
		floor = bucketMin;
		for (const m of past) floor = Math.min(floor, m);

		if (params.force) {
			open = params.force === 'open';
			if (open) loudAt = now;
			return;
		}
		const at = mark();
		if (env >= (open ? at * holdRatio : at)) {
			open = true;
			loudAt = now;
		} else if (open && now - loudAt >= o.holdMs) {
			open = false;
		}
	}

	// --- the frame both paths share: plain delay, or suppression
	// sqrt-Hann in and out at 50 % overlap sums to exactly 1, so with every
	// gain at 1 the output is the input, LOOKAHEAD samples late.
	const win = new Float32Array(N);
	for (let i = 0; i < N; i++)
		win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
	const frame = new Float32Array(N);
	const acc = new Float32Array(N);
	const out = new Float32Array(HOP);
	let fill = 0;
	let read = 0;
	const re = new Float32Array(N);
	const im = new Float32Array(N);
	const bins = N / 2 + 1;
	const noise = new Float32Array(bins);
	const lastPower = new Float32Array(bins);
	const lastGain = new Float32Array(bins).fill(1);
	const gMin = Math.pow(10, o.nsFloorDb / 20);
	const rev = new Uint16Array(N);
	for (let i = 0, bits = Math.log2(N); i < N; i++) {
		let r = 0;
		for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
		rev[i] = r;
	}

	const cosT = new Float32Array(N / 2);
	const sinT = new Float32Array(N / 2);
	for (let k = 0; k < N / 2; k++) {
		cosT[k] = Math.cos((2 * Math.PI * k) / N);
		sinT[k] = Math.sin((2 * Math.PI * k) / N);
	}

	function fft(inverse: boolean) {
		for (let i = 0; i < N; i++) {
			const j = rev[i];
			if (j > i) {
				let t = re[i];
				re[i] = re[j];
				re[j] = t;
				t = im[i];
				im[i] = im[j];
				im[j] = t;
			}
		}
		const sign = inverse ? 1 : -1;
		for (let size = 2; size <= N; size *= 2) {
			const stride = N / size;
			for (let start = 0; start < N; start += size) {
				for (let k = 0; k < size / 2; k++) {
					const wr = cosT[k * stride];
					const wi = sign * sinT[k * stride];
					const a = start + k;
					const b = a + size / 2;
					const xr = re[b] * wr - im[b] * wi;
					const xi = re[b] * wi + im[b] * wr;
					re[b] = re[a] - xr;
					im[b] = im[a] - xi;
					re[a] += xr;
					im[a] += xi;
				}
			}
		}
	}

	/**
	 * Decision-directed Wiener gain per bin, never below gMin: light by
	 * construction, and it works on every bin up to 24 kHz, so a voice keeps
	 * its air. The noise is learned only while the gate is shut or the level
	 * sits on the floor (the rider is not talking), and held while they talk.
	 */
	function suppress() {
		for (let i = 0; i < N; i++) {
			re[i] = frame[i] * win[i];
			im[i] = 0;
		}
		fft(false);
		const quiet = !open || env <= floor * 2;
		for (let k = 0; k < bins; k++) {
			const p = re[k] * re[k] + im[k] * im[k];
			if (quiet) noise[k] = noise[k] > 0 ? 0.95 * noise[k] + 0.05 * p : p;
			let g = 1;
			if (noise[k] > 1e-12) {
				const post = p / noise[k];
				const prio =
					0.98 * ((lastGain[k] * lastGain[k] * lastPower[k]) / noise[k]) +
					0.02 * Math.max(post - 1, 0);
				g = Math.max(gMin, prio / (1 + prio));
			}
			lastGain[k] = g;
			lastPower[k] = p;
			re[k] *= g;
			im[k] *= g;
			if (k > 0 && k < N / 2) {
				re[N - k] *= g;
				im[N - k] *= g;
			}
		}
		fft(true);
		for (let i = 0; i < N; i++) acc[i] += (re[i] / N) * win[i];
	}

	function hop() {
		if (params.ns) suppress();
		else for (let i = 0; i < N; i++) acc[i] += frame[i] * win[i] * win[i];
		out.set(acc.subarray(0, HOP));
		acc.copyWithin(0, HOP);
		acc.fill(0, N - HOP);
		frame.copyWithin(0, HOP);
		fill = N - HOP;
		read = 0;
	}

	return {
		set(next: Partial<VoiceDspParams>) {
			Object.assign(params, next);
		},
		/** One render quantum in, the same length out, LOOKAHEAD samples late. */
		process(input: Float32Array, output: Float32Array) {
			judge(input);
			const target = open ? 1 : 0;
			for (let i = 0; i < input.length; i++) {
				if (fill === 0) fill = N - HOP; // first call: an empty first half
				frame[fill++] = input[i];
				output[i] = out[read++] * gain;
				if (fill === N) hop();
				gain =
					target > gain
						? Math.min(target, gain + upStep)
						: Math.max(target, gain - downStep);
			}
		},
		get level() {
			return env;
		},
		get open() {
			return open;
		},
		/** The mark gating the rider right now, automatic or set. */
		get threshold() {
			return mark();
		},
		get floor() {
			return floor;
		},
	};
}
