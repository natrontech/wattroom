import type { AvConn, AvState } from '$lib/room/av-state.svelte';
import type { DeviceChoices } from '$lib/room/av-devices.svelte';
import type { MicChain } from '$lib/room/mic-chain.svelte';
import type { RiderOutput } from '$lib/room/av-output';

/**
 * The machine's own events, not LiveKit's (#1698) — the three ways a browser
 * takes the room's sound away without anything going wrong.
 *
 * - A long-hidden tab gets its audio graphs suspended. Coming back must not
 *   need a rejoin (#214).
 * - Audio will not start without a gesture behind it (#645), and a rejoin
 *   that never gets one is blocked from the start.
 * - A chosen mic that is unplugged stops being chosen (#640), so the next
 *   open lands on the default instead of failing on an exact deviceId.
 *
 * Idempotent, and it has to be: `leave()` removes the listeners and the
 * sidebar's Join voice reuses this instance (#824).
 */
export interface ListenerHost {
	av: AvState;
	conn: AvConn;
	devices: DeviceChoices;
	chain: MicChain;
	output: RiderOutput;
}

export type Listeners = ReturnType<typeof createListeners>;

export function createListeners(host: ListenerHost) {
	const { av, conn, devices, chain, output } = host;

	function onVisible() {
		if (document.visibilityState !== 'visible') return;
		// Browsers may suspend audio graphs in long-hidden tabs; coming
		// back must not need a rejoin (#214).
		chain.resume();
		output.resume();
	}

	/**
	 * Let the room be heard: resume the graph and tell LiveKit to start the
	 * elements (#645).
	 *
	 * Both halves are needed and neither is enough. `startAudio` plays the
	 * media elements, but their sound reaches the speakers only through the
	 * bus (av-output.ts holds them at volume 0 — `startAudio` unmutes them,
	 * #1339) — so a suspended context is silence whatever LiveKit does. And
	 * resuming the context does not play an element the browser refused.
	 */
	async function startPlayback() {
		chain.resume();
		output.resume();
		try {
			await conn.room?.startAudio();
		} catch {
			// Still no gesture the browser will accept: the strip stays up,
			// which is the whole point of it being status rather than a toast.
		}
		if (conn.room) av.playbackBlocked = !conn.room.canPlaybackAudio;
	}

	/**
	 * Any click, anywhere, is a gesture the browser will accept — so most
	 * riders never see the strip at all. `once` because the graph only needs
	 * unblocking once, and a listener on every pointerdown for the life of a
	 * room is not worth the one it catches.
	 */
	function onFirstGesture() {
		void startPlayback();
	}

	/**
	 * Only judged against a list that names its devices: before permission,
	 * enumerateDevices hands back blank ids, and a blank list must not
	 * un-choose a headset that is sitting right there.
	 */
	const onDeviceChange = async () => {
		await devices.refresh();
		devices.forgetMicIfUnplugged();
	};

	function listen() {
		if (typeof document === 'undefined') return;
		document.addEventListener('visibilitychange', onVisible);
		document.addEventListener('pointerdown', onFirstGesture, { once: true });
		navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
	}
	listen();

	return {
		startPlayback,
		/** The same handlers, so a second call adds nothing. */
		listen,
		/**
		 * This av instance dies with the connection: the listeners go with
		 * it, or six room-hops exhaust the browser's AudioContext budget
		 * (audit #219).
		 */
		unlisten() {
			if (typeof document === 'undefined') return;
			document.removeEventListener('visibilitychange', onVisible);
			document.removeEventListener('pointerdown', onFirstGesture);
			navigator.mediaDevices?.removeEventListener(
				'devicechange',
				onDeviceChange,
			);
		},
	};
}
