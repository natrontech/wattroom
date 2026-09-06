import { mixer } from '$lib/sound/mixer.svelte';
import { riderOf } from '$lib/room/tabs';

/**
 * Everyone else's voice, on its way to your speakers (#152, #179).
 *
 * media-element → per-rider gain → one limiter → destination. The gain is
 * what lets a quiet teammate go ABOVE unity, which `element.volume` cannot —
 * it caps at 1. The limiter exists because of that: faders reach ×2, and two
 * boosted voices summing past 1.0 would hard-clip at the DAC.
 *
 * Split out of av.svelte.ts (#892). Nothing here is reactive — the graph is
 * imperative WebAudio state, and the callers already know when to re-apply.
 */

// Voice output rides the WebAudio bus, so switching speakers needs
// AudioContext.setSinkId — Chrome has it, and Chrome is the platform
// (ADR-0004); elsewhere the picker simply doesn't render.
export const canPickOutput =
	typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

export type RiderOutput = ReturnType<typeof createRiderOutput>;

/**
 * @param sinkId the chosen output device, read at the moment it is applied —
 * a getter, not a value, because the context outlives any one pick.
 */
export function createRiderOutput(sinkId: () => string) {
	let ctx: AudioContext | null = null;
	let bus: DynamicsCompressorNode | null = null;
	const gains = new Map<string, GainNode>();
	const sources = new Map<string, MediaElementAudioSourceNode>();

	/**
	 * A rider's voice as it should sound right now: their fader, or nothing
	 * while you are away (#875) — the room does not play to an empty chair.
	 */
	function gainFor(identity: string) {
		return mixer.muted ? 0 : mixer.riderGain(riderOf(identity));
	}

	function applySink() {
		const id = sinkId();
		if (!ctx || !id || !canPickOutput) return;
		void (ctx as AudioContext & { setSinkId(id: string): Promise<void> })
			.setSinkId(id)
			.catch(() => {
				// unplugged sink: audio falls back to the OS default, not silence
			});
	}

	return {
		applySink,
		/** Put one connection's audio element on the bus. */
		route(identity: string, el: HTMLAudioElement) {
			try {
				if (!ctx) {
					ctx = new AudioContext();
					applySink();
				}
				if (!bus) {
					bus = ctx.createDynamicsCompressor();
					bus.threshold.value = -6;
					bus.knee.value = 4;
					bus.ratio.value = 12;
					bus.attack.value = 0.003;
					bus.release.value = 0.25;
					bus.connect(ctx.destination);
				}
				const source = ctx.createMediaElementSource(el);
				const gain = ctx.createGain();
				gain.gain.value = gainFor(identity);
				source.connect(gain);
				gain.connect(bus);
				gains.set(identity, gain);
				sources.set(identity, source);
			} catch {
				// routing failed: the element still plays at unity — degraded, not broken
			}
		},
		/** One connection left. */
		drop(identity: string) {
			gains.get(identity)?.disconnect();
			gains.delete(identity);
			sources.get(identity)?.disconnect();
			sources.delete(identity);
		},
		/** Ramp every live voice to its current fader; a jump would zipper (#179). */
		applyGains() {
			if (!ctx) return;
			for (const [identity, gain] of gains)
				gain.gain.setTargetAtTime(gainFor(identity), ctx.currentTime, 0.02);
		},
		/**
		 * Browsers may suspend audio graphs in long-hidden tabs; coming back
		 * must not need a rejoin (#214).
		 */
		resume() {
			if (ctx?.state === 'suspended') void ctx.resume();
		},
		close() {
			for (const gain of gains.values()) gain.disconnect();
			for (const source of sources.values()) source.disconnect();
			gains.clear();
			sources.clear();
			void ctx?.close().catch(() => {});
			ctx = null;
			bus = null;
		},
	};
}
