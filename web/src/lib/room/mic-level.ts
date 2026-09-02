import { ENV_ATTACK_MS, ENV_RELEASE_MS, envelope } from '$lib/room/gate';

/**
 * The mic's level, measured continuously (#514).
 *
 * What this replaces: an `AnalyserNode` read from a 120 ms `setInterval`. At
 * fftSize 512 that is a 10.7 ms window every 120 ms — 9 % of the audio looked
 * at, the rest never measured — so whether the gate saw a vowel or the gap
 * between two words was luck, and a run of unlucky reads shut the gate on a
 * rider who never stopped talking. A hidden tab throttles the timer to ~1 s,
 * taking it to 1 %.
 *
 * So the level comes off the audio thread instead: an AudioWorklet sees every
 * sample, whatever the main thread is doing. It ships as a blob for the same
 * reason the ride's ticker does (`workout/ticker.ts`) — a separate module file
 * would need build config on both Vite and vitest to buy nothing.
 *
 * The fallback matters as much as the worklet: a CSP that blocks `blob:` must
 * not leave a rider with a meter at zero and a gate that never opens. It polls
 * an analyser at 40 ms with a 2048-sample window (43 ms), which overlaps
 * rather than samples, and runs the same envelope. It is worse in a hidden
 * tab, and `kind` says which one is live.
 */
export interface MicMeter {
	/** Which mechanism is driving it — only one survives a hidden tab. */
	readonly kind: 'worklet' | 'analyser';
	/** What the rest of the chain connects from: the tap is in-line or beside. */
	readonly out: AudioNode;
	stop(): void;
}

const PROCESSOR = 'mic-level';
/** ~21 ms between posts: fast enough that the gate opens on the first syllable. */
const POST_MS = 20;

/**
 * Per render quantum: RMS, the same envelope as the fallback, audio passed
 * through untouched. Untouched matters — this node sits in the transmit path,
 * so anything it does to the samples is what the room hears.
 */
const WORKLET_SOURCE = `
class MicLevel extends AudioWorkletProcessor {
	constructor() {
		super();
		this.env = 0;
		this.since = 0;
	}
	process(inputs, outputs) {
		const input = inputs[0];
		const channel = input && input[0];
		if (!channel) return true;
		const output = outputs[0];
		if (output) {
			for (let c = 0; c < output.length; c++) output[c].set(input[c] || channel);
		}
		let sum = 0;
		for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
		const rms = Math.sqrt(sum / channel.length);
		const dt = (channel.length / sampleRate) * 1000;
		const tau = rms > this.env ? ${ENV_ATTACK_MS} : ${ENV_RELEASE_MS};
		this.env = rms + (this.env - rms) * Math.exp(-dt / tau);
		this.since += dt;
		if (this.since >= ${POST_MS}) {
			this.since = 0;
			this.port.postMessage(this.env);
		}
		return true;
	}
}
registerProcessor('${PROCESSOR}', MicLevel);
`;

/** Modules are added per context; adding the same one twice throws. */
const loaded = new WeakSet<BaseAudioContext>();

async function addModule(ctx: AudioContext): Promise<boolean> {
	if (loaded.has(ctx)) return true;
	if (!ctx.audioWorklet) return false;
	const url = URL.createObjectURL(
		new Blob([WORKLET_SOURCE], { type: 'text/javascript' }),
	);
	try {
		await ctx.audioWorklet.addModule(url);
		loaded.add(ctx);
		return true;
	} catch {
		return false; // blocked blob:, or no worklet — the analyser still works
	} finally {
		URL.revokeObjectURL(url);
	}
}

export async function createMicMeter(
	ctx: AudioContext,
	source: AudioNode,
	onLevel: (level: number) => void,
): Promise<MicMeter> {
	if (await addModule(ctx)) {
		const node = new AudioWorkletNode(ctx, PROCESSOR);
		node.port.onmessage = (event) => onLevel(event.data as number);
		source.connect(node);
		return {
			kind: 'worklet',
			out: node,
			stop() {
				node.port.onmessage = null;
				node.disconnect();
			},
		};
	}

	const analyser = ctx.createAnalyser();
	analyser.fftSize = 2048;
	source.connect(analyser);
	const bins = new Float32Array(analyser.fftSize);
	let env = 0;
	let last = 0;
	const timer = setInterval(() => {
		analyser.getFloatTimeDomainData(bins);
		let sum = 0;
		for (const v of bins) sum += v * v;
		const now = performance.now();
		const dt = last > 0 ? now - last : POST_MS;
		last = now;
		env = envelope(env, Math.sqrt(sum / bins.length), dt);
		onLevel(env);
	}, 40);
	return {
		kind: 'analyser',
		out: source,
		stop() {
			clearInterval(timer);
			analyser.disconnect();
		},
	};
}
