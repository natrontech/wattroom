import { createMicMeter, type MicMeter } from '$lib/channel/mic-level';
import { device } from '$lib/device.svelte';
import { mixer } from '$lib/sound/mixer.svelte';
import { riderOf } from '$lib/channel/tabs';
import { makeCeiling } from '$lib/sound/cue-graph';
import { onDuck } from '$lib/sound/duck';

/**
 * Everyone else's voice, on its way to your speakers (#152, #179).
 *
 * media-stream → per-rider gain → one ceiling → destination. The gain is
 * what lets a quiet teammate go ABOVE unity, which `element.volume` cannot —
 * it caps at 1. The ceiling exists because of that: faders reach ×2, and two
 * boosted voices summing past 1.0 would hard-clip at the DAC.
 *
 * A ceiling, never the cue bus's compressor. That one sat here until the
 * voice-quality reports of 2026-11: it lifted every voice 2.6 dB, squeezed
 * them from -8 dBFS, and pulled each voice down under any other loud one, by
 * 2.7 dB under a voice at -6 dBFS RMS, over a 250 ms release (measured in
 * Chrome). Talking at once, or over a share, every voice sank.
 *
 * The graph taps `el.srcObject` with `createMediaStreamSource`, not the
 * element itself with `createMediaElementSource` (#1160, a rider report: the
 * speaking ring and ducking stopped reacting to real voices). A
 * `MediaElementAudioSourceNode` built on an element whose `srcObject` is a
 * live WebRTC `MediaStream` reads back silence in Chromium — reproduced with
 * `RTCPeerConnection.getStats()` showing real, continuous RTP arriving
 * (audioLevel ~0.5, packetsLost 0) and the element itself genuinely playing
 * (`currentTime` advancing in real time) while the tapped node still read
 * exactly zero the whole time. `createMediaStreamSource` on the identical
 * stream, at the identical moment, read real signal. The element still has
 * to exist (LiveKit's own attach/detach and the browser's playback-permission
 * bookkeeping want one), but it must not also play on its own: since nothing
 * here commandeers its native output the way `createMediaElementSource`
 * does, an audible element sounds a second, unfadered, undirected copy of
 * every voice alongside the one this graph controls — a few milliseconds
 * apart, which is a comb filter, which is the "phaser" riders reported
 * (#1339).
 *
 * Muting the element is not enough to stop that. `Room.startAudio()` sets
 * `muted = false` on every attached element before it plays them — the app
 * calls it on the first click after a join (#645) and LiveKit calls it
 * itself when a screen share brings audio (#1124) — so the element is held
 * silent by `volume = 0` as well, which nothing in the SDK touches.
 *
 * On a computer it is the other way round for most voices: the element plays
 * them and the graph only meters them (`viaElement`).
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
 * @param onLevel every rider's envelope, taken on this graph (#987). Who is
 * talking is measured here rather than remembered from the server's broadcast:
 * the audio is already on its way through these nodes, and a meter that lives
 * on the chain cannot outlive the voice it is measuring.
 */
export function createRiderOutput(
	sinkId: () => string,
	onLevel?: (identity: string, level: number) => void,
) {
	let ctx: AudioContext | null = null;
	let bus: AudioNode | null = null;
	const gains = new Map<string, GainNode>();
	const sources = new Map<string, MediaStreamAudioSourceNode>();
	const meters = new Map<string, MicMeter>();
	const elements = new Map<string, HTMLAudioElement>();
	// Which keys carry a shared machine's audio rather than a voice (#1124).
	// A Set rather than a suffix on the key, so nothing has to parse a string
	// to know what it is holding.
	const shares = new Set<string>();
	// How far shared audio is dipped right now. Voices are never ducked —
	// ducking exists to get music out from under them (ADR-0011), and a
	// second voice is not music.
	let duckFactor = 1;

	/**
	 * A rider's voice as it should sound right now: their fader, or nothing
	 * while you are away (#875) — the call does not play to an empty chair.
	 */
	function gainFor(key: string) {
		if (mixer.muted) return 0;
		// A shared machine is the "music" profile of ADR-0011: its own mixer
		// channel, and it ducks under voice like the jukebox does. A rider's
		// voice takes their fader and is never dipped.
		if (shares.has(key)) return mixer.share * duckFactor;
		return mixer.riderGain(riderOf(key));
	}

	/**
	 * Whether a connection plays from its element rather than the graph.
	 *
	 * One path, never two (#1339). The graph reads a stream through a FIFO up
	 * to six output buffers deep, so it trails the element by a few to tens of
	 * milliseconds, by a different amount after every join. 2026.11.24 played
	 * an element copy 14 dB under the graph, and riders heard voices doubled
	 * and strange until they restarted.
	 *
	 * On a computer the element is the path: the mic's echo canceller only
	 * hears what an element plays (`remote-only`, `capture.ts`), so a voice
	 * through WebAudio comes back to the crew from any rider on speakers. A
	 * fader above 100 % needs the graph, because `volume` stops at 1, and that
	 * voice leaves the canceller's hearing: the cost of a boost. A phone keeps
	 * the graph (its canceller hears everything, and iOS ignores `volume`). A
	 * share is music, which stays out of the canceller.
	 */
	function viaElement(key: string) {
		return !device.coarse && !shares.has(key) && gainFor(key) <= 1;
	}
	function graphGain(key: string) {
		return viaElement(key) ? 0 : gainFor(key);
	}
	function elementVolume(key: string) {
		return viaElement(key) ? gainFor(key) : 0;
	}

	function applySink() {
		const id = sinkId();
		if (!ctx || !id || !canPickOutput) return;
		// Unplugged sink: audio falls back to the OS default, not silence.
		for (const out of [ctx, ...elements.values()])
			void (out as unknown as { setSinkId(id: string): Promise<void> })
				.setSinkId(id)
				.catch(() => {});
	}

	// One duck for the whole app (#988) — this graph is told when to move,
	// it does not run a timer of its own.
	const stopDucking = onDuck(({ down }) => {
		duckFactor = down ? mixer.duck : 1;
		if (!ctx) return;
		for (const [key, gain] of gains) {
			if (!shares.has(key)) continue;
			gain.gain.setTargetAtTime(gainFor(key), ctx.currentTime, 0.02);
		}
	});

	/** One connection left: its nodes come off the bus and out of the maps. */
	function drop(key: string) {
		meters.get(key)?.stop();
		meters.delete(key);
		gains.get(key)?.disconnect();
		gains.delete(key);
		sources.get(key)?.disconnect();
		sources.delete(key);
		shares.delete(key);
		elements.delete(key);
	}

	return {
		applySink,
		/**
		 * Put one connection's audio element on the bus.
		 *
		 * `key` is the identity for a voice and something else for anything
		 * else that rider publishes — a map keyed by identity ALONE silently
		 * replaced one with the other, so a rider sharing their computer's
		 * audio lost their voice on everyone's speakers (#1124). `share` says
		 * which fader the key answers to.
		 */
		route(key: string, el: HTMLAudioElement, share = false) {
			const identity = key;
			try {
				if (!ctx) {
					ctx = new AudioContext();
					applySink();
				}
				if (!bus) {
					bus = makeCeiling(ctx, ctx.destination);
				}
				// A key routed twice is a voice heard twice (#1339): the first
				// graph would stay wired to the bus with nothing left holding
				// its handle. Before the share flag goes on: the drop takes it off.
				// The old element plays until the SDK lets its track go, which
				// can be after this one arrives (#4177): it goes quiet now.
				const old = elements.get(identity);
				if (old && old !== el) {
					old.volume = 0;
					old.muted = true;
				}
				if (gains.has(identity)) drop(identity);
				if (share) shares.add(identity);
				const source = ctx.createMediaStreamSource(el.srcObject as MediaStream);
				const gain = ctx.createGain();
				gain.gain.value = graphGain(identity);
				gain.connect(bus);
				gains.set(identity, gain);
				sources.set(identity, source);
				// Tapping the stream, not the element, leaves the element's own
				// output live beside the graph. Both are set only once the graph
				// is wired, so a routing failure below falls back to the
				// element's native playback rather than to silence. Both knobs:
				// `startAudio()` flips `muted` back (see the top of this file);
				// `volume` it leaves alone. Which of the two plays: `viaElement`.
				elements.set(identity, el);
				el.volume = elementVolume(identity);
				el.muted = el.volume === 0;
				applySink();
				// The meter goes in ahead of the fader, so what it reads is the
				// voice as sent rather than as this listener chose to hear it —
				// turning somebody down must not stop them lighting up. The
				// worklet passes audio through and the analyser taps beside it,
				// so `out` is what carries on to the gain either way, and the
				// whole chain reaches the destination — an unconnected meter is
				// never pulled.
				// No meter on a share: the talk detector decides who is SPEAKING,
				// and a rider whose computer is playing music is not. Ringing
				// them would be the machine talking with their face on it.
				if (!onLevel || share) {
					source.connect(gain);
				} else {
					const level = (value: number) => onLevel(identity, value);
					source.connect(gain); // audible immediately; the meter is async
					void createMicMeter(ctx, source, level)
						.then((meter) => {
							if (!gains.has(identity)) {
								meter.stop();
								return;
							}
							if (meter.out !== source) {
								source.disconnect(gain);
								meter.out.connect(gain);
							}
							meters.set(identity, meter);
						})
						.catch(() => {
							// No meter is a call whose rings never light, not a
							// call with no sound in it. The voice is already
							// connected above.
						});
				}
			} catch {
				// routing failed: unmute so the element still plays at unity —
				// degraded (no fader, no meter), not silent.
				el.muted = false;
				el.volume = 1;
			}
		},
		/** One connection left. */
		drop,
		/** Ramp every live voice to its current fader; a jump would zipper (#179). */
		applyGains() {
			if (!ctx) return;
			for (const [key, gain] of gains)
				gain.gain.setTargetAtTime(graphGain(key), ctx.currentTime, 0.02);
			for (const [key, el] of elements) {
				el.volume = elementVolume(key);
				el.muted = el.volume === 0;
			}
		},
		/**
		 * Browsers may suspend audio graphs in long-hidden tabs; coming back
		 * must not need a rejoin (#214).
		 */
		/** Returns whether the graph is running now (or there is none yet). */
		resume() {
			if (ctx?.state === 'suspended') void ctx.resume();
			return !ctx || ctx.state === 'running';
		},
		close() {
			stopDucking();
			shares.clear();
			for (const meter of meters.values()) meter.stop();
			meters.clear();
			for (const gain of gains.values()) gain.disconnect();
			for (const source of sources.values()) source.disconnect();
			gains.clear();
			sources.clear();
			elements.clear();
			void ctx?.close().catch(() => {});
			ctx = null;
			bus = null;
		},
	};
}
