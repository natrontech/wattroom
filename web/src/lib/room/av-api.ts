import { mixer } from '$lib/sound/mixer.svelte';
import type { AvConn, AvState } from '$lib/room/av-state.svelte';
import type { DeviceChoices } from '$lib/room/av-devices.svelte';
import type { Stage } from '$lib/room/av-stage.svelte';
import type { RiderOutput } from '$lib/room/av-output';
import type { Seats } from '$lib/room/av-seats';
import type { Mic } from '$lib/room/av-mic';
import type { Publish } from '$lib/room/av-publish';
import type { Tabs } from '$lib/room/av-tabs';
import type { Listeners } from '$lib/room/av-listeners';
import type { Session } from '$lib/room/av-session';
import { canPickOutput } from '$lib/room/av-output';
import { mountTrack } from '$lib/room/mount-track';

/**
 * What the room may ask of AV (#1698).
 *
 * One flat surface over the parts `av.svelte.ts` assembles, because that is
 * what the room page wants: a rider does not think of the mic chain, the
 * claim protocol and the seat ledger as three things. Every reader is a
 * getter and never a copy — the sub-stores hold the `$state`, and a value
 * read here has to be the one they hold now.
 *
 * Nothing but delegation belongs in here. Where two parts have to be
 * orchestrated, the orchestration lives with whichever of them owns the
 * question: `toggleMic` is in `av-tabs.ts` because it has to ask which tab
 * holds the mic first.
 */
export interface AvParts {
	av: AvState;
	conn: AvConn;
	devices: DeviceChoices;
	stage: Stage;
	output: RiderOutput;
	seats: Seats;
	mic: Mic;
	publish: Publish;
	tabs: Tabs;
	listeners: Listeners;
	session: Session;
}

export function roomAvApi(parts: AvParts) {
	const {
		av,
		conn,
		devices,
		stage,
		output,
		seats,
		mic,
		publish,
		tabs,
		listeners,
		session,
	} = parts;
	const chain = mic.chain;

	return {
		get dropped() {
			return av.dropped;
		},
		/** What the drop-rejoin should do with the mic: what the rider had. */
		get micBeforeDrop() {
			return conn.micBeforeDrop;
		},
		get status() {
			return av.status;
		},
		get micOn() {
			return av.micOn;
		},
		get camOn() {
			return av.camOn;
		},
		/** Stepped out (#706) — the mic and camera are held down until back. */
		get away() {
			return av.away;
		},
		setAway: publish.setAway,
		get sharing() {
			return av.sharing;
		},
		/** Whether the room can hear this machine as well as see it (#1124). */
		get sharingAudio() {
			return av.sharingAudio;
		},
		/** Whether the rider wants it to, share after share (#1751). */
		get shareSound() {
			return av.shareSound;
		},
		get error() {
			return av.error;
		},
		get videoOf() {
			return stage.videoOf;
		},
		get speaking() {
			return av.speaking;
		},
		get voice() {
			return av.voice;
		},
		get micLevel() {
			return chain.level;
		},
		get transmitting() {
			return chain.transmitting;
		},
		get mode() {
			return chain.mode;
		},
		get gateThreshold() {
			return chain.threshold;
		},
		/** What is gating you right now — the stored value, doubled by music. */
		get effectiveGateThreshold() {
			return chain.effectiveThreshold;
		},
		get pttHeld() {
			return chain.pttHeld;
		},
		setMode: mic.setMode,
		setGateThreshold: mic.setThreshold,
		get micTesting() {
			return chain.testing;
		},
		/** The browser muted this tab; one press fixes it (#645). */
		get playbackBlocked() {
			return av.playbackBlocked;
		},
		startPlayback: listeners.startPlayback,
		/** Your mic and camera live in another of your tabs (#293). */
		get handedOff() {
			return av.handedOff;
		},
		/** Bring them back here. */
		takeOver: () => tabs.takeOver(),
		/** The capture died under an open mic (#640) and nothing has reopened it. */
		get micFault() {
			return chain.fault;
		},
		reconnectMic: tabs.reconnectMic,
		// ── Devices: what's plugged in, what's chosen, and switching live ──────
		get mics() {
			return devices.mics;
		},
		get cams() {
			return devices.cams;
		},
		get outs() {
			return devices.outs;
		},
		get micId() {
			return devices.micId;
		},
		get camId() {
			return devices.camId;
		},
		get outId() {
			return devices.outId;
		},
		get canPickOutput() {
			return canPickOutput;
		},
		refreshDevices: devices.refresh,
		setMic: mic.setDevice,
		async setCam(id: string) {
			devices.setCam(id);
			await publish.switchCam(id);
		},
		setOut(id: string) {
			devices.setOut(id);
			output.applySink();
		},
		toggleMicTest: mic.toggleTest,
		setPtt: mic.setPtt,
		setDeckPlaying: mic.setDeckPlaying,
		/**
		 * Applies the mixer's per-rider gain live (#179, #463). One fader per
		 * rider, however many tabs they are connected from; a short ramp, so a
		 * dragged slider does not zipper.
		 */
		setRiderGain(id: string, v: number, name?: string) {
			mixer.setRiderGain(id, v, name);
			output.applyGains();
		},
		/**
		 * The same, for whatever machine is being shared into the room
		 * (#1124). One fader for all of them: a rider is hearing one room, and
		 * two people sharing at once is not the case to build a mixer for.
		 */
		setShareGain(v: number) {
			mixer.setShare(v);
			output.applyGains();
		},
		join: session.join,
		toggleMic: tabs.toggleMic,
		toggleCam: publish.toggleCam,
		toggleShare: publish.toggleShare,
		setShareSound: publish.setShareSound,
		/** Everything the stage can show, screens first (#280). */
		get stageSources() {
			return stage.sources;
		},
		/** The rider's pick. The room page resolves it against the full list —
		 *  longer than ours, the jukebox video is on it too (#316). */
		get stagePick() {
			return stage.pick;
		},
		/** Pick a source, or null to follow the newest share again. */
		setStage(key: string | null) {
			stage.setPick(key);
		},
		/** The stage surface: a screen is a document (contain), a face isn't.
		 *  A key we do not know is not ours to draw — the jukebox seats itself. */
		attachStage(container: HTMLElement, key: string) {
			const source = stage.sources.find((candidate) => candidate.key === key);
			mountTrack(
				container,
				source
					? seats.get(source.kind === 'screen' ? 'screen' : 'video', source.id)
							?.track
					: undefined,
				source?.kind === 'screen' ? 'contain' : 'cover',
			);
		},
		attach(riderId: string, container: HTMLElement) {
			mountTrack(container, seats.get('video', riderId)?.track, 'cover');
		},
		leave: session.leave,
	};
}
