/**
 * The transmit path's audio-thread half: a lookahead and the gate, sample by
 * sample.
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
}

export interface VoiceDspParams {
	/** The gate's mark when not automatic (RMS 0..1). */
	threshold: number;
	auto: boolean;
	/** Push-to-talk and a closed call decide, not the level. */
	force: 'open' | 'shut' | null;
}

/** Audio is held back this many samples: the gate's head start on a word. */
export const LOOKAHEAD = 512;

export function createVoiceDsp(o: VoiceDspOptions) {
	const sr = o.sampleRate;

	const params = { threshold: 0.02, auto: true, force: null } as {
		threshold: number;
		auto: boolean;
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

	const delay = new Float32Array(LOOKAHEAD);
	let slot = 0;

	return {
		set(next: Partial<VoiceDspParams>) {
			Object.assign(params, next);
		},
		/** One render quantum in, the same length out, LOOKAHEAD samples late. */
		process(input: Float32Array, output: Float32Array) {
			judge(input);
			const target = open ? 1 : 0;
			for (let i = 0; i < input.length; i++) {
				output[i] = delay[slot] * gain;
				delay[slot] = input[i];
				slot = (slot + 1) % LOOKAHEAD;
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
