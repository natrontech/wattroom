/**
 * This machine's microphone (#892): capture → meter → gate → published track,
 * and everything that decides whether anything reaches the call.
 *
 * The mic path (#151, SPEC voice channel audio): capture (browser DSP on) →
 * starting gain (#2120) → meter → gate gain → published track. The gate
 * drives the GAIN, never the track's mute — a muted track broadcasts state,
 * and a gate that flaps everyone's muted chip per pause in speech is worse
 * than no gate.
 *
 * A HANDHELD takes none of that: it publishes the capture as it comes and the
 * mic button is the gate, because holding a capture open is what puts the
 * call on a phone's earpiece. `open()` has the why; docs/SPEC.md has it as a
 * product fact.
 *
 * Split out of `av.svelte.ts`, which was one closure wide enough that a
 * cross-wired bug looked local. The host owns the LiveKit connection and hands
 * this two functions to reach it, so nothing here imports the SDK.
 */
import { glideTo } from '$lib/sound/glide';
import {
	GATE_ATTACK_MS,
	GATE_RELEASE_MS,
	GATE_SHUT,
	type GateState,
	gateStep,
} from '$lib/channel/gate';
import { type MicDevices, captureMic } from '$lib/channel/capture';
import { createGateSettings } from '$lib/channel/gate-settings.svelte';
import { type MicMeter, createMicMeter } from '$lib/channel/mic-level';
import {
	STARTING_GAIN_GLIDE_MS,
	type StartingGain,
	createStartingGain,
} from '$lib/channel/starting-gain';

export interface MicChainHost {
	/** The rider's chosen input, and what to do when that choice is gone. */
	devices: MicDevices;
	/** Put the transmit track on the wire. A no-op outside a call. */
	publish(track: MediaStreamTrack): Promise<void>;
	unpublish(track: MediaStreamTrack): void;
	/** Is this machine actually transmitting — is anyone on the other end? */
	live(): boolean;
	/** The level the call hears: 0 whenever nothing is getting through. */
	heard(level: number): void;
	/** The meter has gone; nothing is left to report the rider falling quiet. */
	silenced(): void;
	/** The capture device went away under an open mic (#640). */
	captureLost(): void;
	/**
	 * Is this a machine held in the hand? A phone publishes its capture as it
	 * comes — `open()` says why, and it is not a preference.
	 */
	handheld(): boolean;
}

interface Chain {
	/** null on a handheld: there is no graph, the capture IS the track. */
	ctx: AudioContext | null;
	raw: MediaStream;
	/** The input it opened, '' for the browser's default. */
	mic: string;
	/** Whether the meter has seen anything but digital silence (#4161). */
	heard: boolean;
	gain: GainNode | null;
	/** The starting gain's node and its model; null on a handheld. */
	lift: { node: GainNode; model: StartingGain; aimed: number } | null;
	meter: MicMeter | null;
	track: MediaStreamTrack;
	/** The capture track being watched for `ended` (#640). */
	capture: MediaStreamTrack | undefined;
}

export type MicChain = ReturnType<typeof createMicChain>;

/** SPEC (#4161): a chosen mic that sends pure silence this long is cut off. */
export const SILENT_MS = 3000;

export function createMicChain(host: MicChainHost) {
	const settings = createGateSettings();
	let chain: Chain | null = null;
	/** Bumped by every close: an open still on its way that finds it moved stands down. */
	let epoch = 0;
	let gate: GateState = GATE_SHUT;
	let level = $state(0);
	let transmitting = $state(false);
	let testing = $state(false);
	/** The mic is opening: the device takes from ~0.1 s to a few seconds. */
	let starting = $state(false);
	/**
	 * The capture died under us (#640): a headset unplugged, Bluetooth dropping
	 * to its phone profile, another app taking the device. Where we publish our
	 * own WebAudio track, LiveKit's device-loss recovery never sees it — the
	 * destination keeps emitting silence and nothing notices. `ended` on the
	 * capture is watched on both paths regardless, so the rider is told the
	 * same way whichever one they are on. Persistent until
	 * the mic is open again: the rider three metres away has to be able to see
	 * why the call stopped hearing them.
	 */
	let fault = $state(false);

	/**
	 * The capture ended without us asking (#640). `stop()` never fires this and
	 * `close()` unhooks it first anyway, so what arrives here is the device going
	 * away under a mic the rider believes is open — or under a mic test, which
	 * ends the same way and leaves the same fault to show.
	 */
	function onCaptureEnded() {
		fault = true;
		close();
		host.captureLost();
	}

	function watchCapture(raw: MediaStream) {
		const capture = raw.getAudioTracks()[0];
		capture?.addEventListener('ended', onCaptureEnded);
		return capture;
	}

	const capture = () => captureMic(host.devices);

	/** Every level the audio thread reports: the meter's number and the gate's. */
	function onLevel(next: number) {
		level = next;
		if (next > 0 && chain) chain.heard = true;
		liftStart();
		runGate();
		// Your own tile lights on the same measurement as everybody else's
		// (#987). What the call hears is what the gate lets through, so a level
		// under your own threshold is not you speaking — and neither is a hot
		// mic you have switched off.
		host.heard(host.live() && gate.open ? next : 0);
	}

	/**
	 * Lifts a quiet start toward where this device last settled. Re-aimed only
	 * on a real move: each glide is an automation event the param keeps.
	 */
	function liftStart() {
		const lift = chain?.lift;
		if (!lift || !chain?.ctx) return;
		const now = performance.now();
		const next = lift.model.step(
			level,
			lift.node.gain.value,
			settings.effective,
			now,
		);
		if (Math.abs(next - lift.aimed) < 0.02) return;
		lift.aimed = next;
		glideTo(
			lift.node.gain,
			next,
			chain.ctx.currentTime,
			STARTING_GAIN_GLIDE_MS,
		);
	}

	/**
	 * capture → starting gain → level → gate gain. The caller connects the gain
	 * to wherever the audio is going: the call, or your own ears.
	 */
	async function build() {
		const { raw, mic } = await capture();
		// Opus's rate, not the output device's (#1340): a context left to
		// default follows the speakers — 44.1 kHz on plenty of Macs and DACs —
		// and the mic is then resampled 48 → 44.1 → 48 on its way to the wire.
		const ctx = new AudioContext({ sampleRate: 48_000 });
		const source = ctx.createMediaStreamSource(raw);
		// Before the meter: the gate's thresholds were set against the settled
		// level this lifts toward, so the gate has to see the lifted signal.
		// Keyed by the mic it opened, which #4161 may have chosen.
		const lift = {
			node: ctx.createGain(),
			model: createStartingGain(performance.now(), mic),
			aimed: 1,
		};
		source.connect(lift.node);
		const gain = ctx.createGain();
		gain.gain.value = 0; // closed until the gate opens
		const meter = await createMicMeter(ctx, lift.node, onLevel);
		meter.out.connect(gain);
		gate = GATE_SHUT;
		return { ctx, raw, mic, gain, lift, meter };
	}

	function setGate(openNow: boolean) {
		if (!chain?.gain || !chain.ctx) return;
		transmitting = openNow;
		// Up in 5 ms, down over 150 ms (SPEC): opening fast is what keeps the
		// first syllable, and a close that fades is one the call forgives — it
		// reads as a breath ending rather than a cut, and re-opening inside the
		// fade is inaudible.
		glideTo(
			chain.gain.gain,
			openNow ? 1 : 0,
			chain.ctx.currentTime,
			openNow ? GATE_ATTACK_MS : GATE_RELEASE_MS,
		);
	}

	function runGate() {
		if (!chain?.ctx || (!host.live() && !testing)) return;
		if (settings.mode === 'ptt') {
			setGate(settings.pttHeld);
			return;
		}
		// The hold no longer chases the timer that fed it (#214's fix): the level
		// arrives from the audio thread, at the same rate whether this tab is in
		// front or behind another window.
		const was = gate.open;
		gate = gateStep(gate, level, settings.effective, performance.now());
		if (gate.open !== was) setGate(gate.open);
	}

	/**
	 * Opens the mic onto the wire. Throws what the browser refused; resolves
	 * false when a close landed first.
	 *
	 * A muted mic holds no capture (#4161): `close()` stops it, because a
	 * Bluetooth headset stays on its call profile for as long as anything
	 * captures its mic. So every unmute is a fresh open, and `starting` says so
	 * on the mic button while the device comes up. That can take seconds, so a
	 * mute, Away or leave in the meantime wins: the open finds `epoch` moved,
	 * hands its capture back and stands down, rather than going live behind it.
	 */
	async function open(): Promise<boolean> {
		if (chain) close(); // a mic test or stale chain must not orphan a stream
		const mine = ++epoch;
		starting = true;
		try {
			const next = await openChain();
			if (mine !== epoch) {
				release(next);
				return false;
			}
			chain = next;
			await host.publish(next.track);
			if (mine !== epoch) {
				host.unpublish(next.track); // closed mid-publish: take it back off
				return false;
			}
			if (!next.ctx) transmitting = true; // a handheld's mic button is its gate
			// Opening again is the only thing that clears the fault — the rider
			// pressing Reconnect, tapping the mic, or the next join finding it.
			fault = false;
			if (next.mic && next.mic !== host.devices.micId) watchSilence(next);
			// The grant just made the labels readable (#658).
			void host.devices.refresh();
			return true;
		} finally {
			if (mine === epoch) starting = false;
		}
	}

	/**
	 * The computer's mic chosen beside Bluetooth headphones (#4161) can be cut
	 * off in hardware and still listed: a MacBook's is while its lid is shut.
	 * Pure digital silence for SILENT_MS is that, and a mic that hears nothing
	 * is worse than call-quality music, so the chain goes back to the default
	 * and the store leaves that mic alone for this page.
	 */
	function watchSilence(opened: Chain) {
		setTimeout(() => {
			if (chain !== opened || opened.heard) return;
			host.devices.heardNothing(opened.mic);
			void open().catch(() => {});
		}, SILENT_MS);
	}

	/** Builds the chain without putting it anywhere: `open` decides that. */
	async function openChain(): Promise<Chain> {
		if (host.handheld()) {
			// A phone publishes what getUserMedia handed over — no meter, no
			// gate (#2142). Two reasons, and they are the same reason:
			//
			//  - While a page holds an audio capture, iOS and Android both put
			//    the device into its communication mode and play the page —
			//    WebAudio and media elements alike — out of the EARPIECE.
			//    Nothing on the web can override that route; releasing the
			//    capture is the only thing that hands the loudspeaker back.
			//    A gate holds the capture open for as long as a rider is in
			//    voice, so a phone sat in earpiece mode the whole time (rider
			//    report: "no speaker like on phone", and the call sounding
			//    terrible with it). Here the mic button IS the capture.
			//  - capture → worklet → MediaStreamDestination is a round trip a
			//    phone does not always keep up with, and the same report had
			//    the input lagging and flickering — a gate chattering mid-word
			//    on a starved audio thread.
			//
			// ponytail: no gate on a handheld, and the mic button is it. The
			// upgrade path would be a meter cheap enough to run there — which
			// still would not buy the loudspeaker back, so it is not on the
			// way to anything.
			const { raw, mic } = await capture();
			return {
				ctx: null,
				raw,
				mic,
				heard: false,
				gain: null,
				lift: null,
				meter: null,
				track: raw.getAudioTracks()[0],
				capture: watchCapture(raw),
			};
		}
		const { ctx, raw, mic, gain, lift, meter } = await build();
		const dest = ctx.createMediaStreamDestination();
		gain.connect(dest);
		return {
			ctx,
			raw,
			mic,
			heard: false,
			gain,
			lift,
			meter,
			track: dest.stream.getAudioTracks()[0],
			capture: watchCapture(raw),
		};
	}

	/**
	 * Mic test (#178): hear yourself through the gate before anyone else does.
	 * Same chain as transmission, output to the local speakers; the meter and
	 * the transmitting verdict run identically. Only outside a live mic — in
	 * voice, the meter is already the truth.
	 */
	async function startTest() {
		if (chain || testing) return;
		const { ctx, raw, mic, gain, lift, meter } = await build();
		void host.devices.refresh(); // the grant just made the labels readable (#658)
		gain.connect(ctx.destination); // your own ears, not the call
		const dest = ctx.createMediaStreamDestination();
		chain = {
			ctx,
			raw,
			mic,
			heard: false,
			gain,
			lift,
			meter,
			track: dest.stream.getAudioTracks()[0],
			capture: watchCapture(raw),
		};
		testing = true;
	}

	function stopTest() {
		if (!testing) return;
		testing = false;
		close();
	}

	/** Hands a chain's capture, graph and track back to the machine. */
	function release(c: Chain) {
		// Unhook before stopping: a close the rider asked for is not a fault.
		c.capture?.removeEventListener('ended', onCaptureEnded);
		c.meter?.stop();
		c.lift?.model.close();
		host.unpublish(c.track);
		for (const t of c.raw.getTracks()) t.stop();
		void c.ctx?.close();
	}

	function close() {
		epoch += 1; // an open still on its way stands down
		starting = false;
		if (chain) release(chain);
		chain = null;
		gate = GATE_SHUT;
		level = 0;
		transmitting = false;
		testing = false;
		host.silenced();
	}

	return {
		get level() {
			return level;
		},
		get transmitting() {
			return transmitting;
		},
		get testing() {
			return testing;
		},
		get starting() {
			return starting;
		},
		get fault() {
			return fault;
		},
		/** Suspended contexts do not run their audio thread — no level, no gate. */
		resume() {
			if (chain?.ctx?.state === 'suspended') void chain.ctx.resume();
		},
		/** Stepping away, or handing the mic to another tab, is not a fault. */
		clearFault() {
			fault = false;
		},
		open,
		close,
		startTest,
		stopTest,

		// --- the gate's settings, which nothing outside this chain reads
		get mode() {
			return settings.mode;
		},
		get threshold() {
			return settings.threshold;
		},
		get effectiveThreshold() {
			return settings.effective;
		},
		get pttHeld() {
			return settings.pttHeld;
		},
		setMode(next: 'gate' | 'ptt') {
			settings.setMode(next);
			// Leaving push-to-talk shuts the gate rather than inheriting the
			// button's last state — and the GAIN has to follow, not wait for the
			// next level to arrive. Shutting only `gate` left a released button
			// still transmitting until the meter's next post.
			if (next === 'gate') {
				gate = GATE_SHUT;
				setGate(false);
			}
			runGate();
		},
		setThreshold(next: number) {
			settings.setThreshold(next);
			runGate();
		},
		setPttHeld(held: boolean) {
			settings.setPttHeld(held);
			runGate();
		},
		setDeckPlaying(playing: boolean) {
			settings.setDeckPlaying(playing);
		},
	};
}
