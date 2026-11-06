import { tabId } from '$lib/channel/rejoin';
import { deviceWord } from '$lib/device.svelte';
import type { PauseState, ViewState } from '$lib/protocol';
import { shiftAnswer } from '$lib/ride/easier-harder';
import { gearsEnabled } from '$lib/ride/gears-enabled';
import { createRemoteRunner } from '$lib/ride/keys';
import { createRideShift } from '$lib/ride/ride-shift';
import type { RoadAlone } from '$lib/ride/road-alone.svelte';
import { riderLane } from '$lib/rider-lane.svelte';
import { askPage, toggleMap } from '$lib/session/computer-pages';
import { computerShown } from '$lib/session/computer-shown.svelte';
import { DEFAULTS } from '$lib/workout/guards';
import type { createRideSession } from '$lib/workout/session.svelte';
import { worldPicture } from '$lib/world/picture.svelte';
import { askCamera, askPhoto, askViewFlip } from '$lib/world/ride-view';

type Session = ReturnType<typeof createRideSession>;

/** What the riding screen's view says to the phone (#4223, #4253). */
export function viewNow(): ViewState {
	return {
		page: computerShown.page,
		world: computerShown.world,
		camera: computerShown.world ? (computerShown.camera ?? '') : '',
		pictures: worldPicture.taken,
	};
}

/** A workout alone pauses from the phone once its count-in is over (#3217). */
export function pauseOf(session: Session | null): PauseState {
	return {
		pausable: !!session && session.state !== 'countdown',
		paused: !!session?.held,
	};
}

/**
 * The phone remote of the device's ride alone (#4425), the way a voice
 * channel's connection serves it for a ride there (#3217): this screen claims
 * the rider's lane while it rides alone, runs the phone's presses through the
 * same paths as the keys, and answers with its gear, pause and view. Talk and
 * Cheer have no call or channel here, so the phone draws neither.
 *
 * Called in the ride alone's effect root (ride-alone-effects.svelte.ts).
 */
export function serveRideRemote(ride: {
	session: () => Session | null;
	road: () => RoadAlone | null;
}) {
	// The workout under way, count-in included; its summary is no ride.
	const workout = () => {
		const s = ride.session();
		return s && s.state !== 'idle' && s.state !== 'done' ? s : null;
	};
	const road = () => {
		const r = ride.road();
		return r?.solo.trainer ? r : null;
	};
	const riding = () => !!workout() || !!road();

	// The tab label as the sensor claim sends it (sensor-claim.ts): blocked
	// storage is one label in every tab, so it sends none.
	$effect(() => {
		const tab = tabId();
		riderLane.claimRide(
			riding(),
			tab === 'no-storage' ? '' : tab,
			deviceWord(),
		);
	});

	// One shifter for the phone's taps, as the riding screen's keys have theirs.
	const shift = $derived.by(() => {
		const s = workout();
		if (s) return createRideShift(s);
		return road()?.solo.shift ?? null;
	});
	const remote = createRemoteRunner(
		{
			shifts: () => gearsEnabled('phone') && !!shift,
			press: (dir, source) => shift?.press(dir, source),
			release: (source) => shift?.release(source),
			// With the phone's gears off a tap is the bias, as the ride's own
			// − and + move it (#4163). A road's watts are the road's.
			trim: (dir) => workout()?.nudgeBias(dir * DEFAULTS.biasStep),
		},
		() => {},
		{
			pause: () => workout()?.pause(),
			resume: () => workout()?.resume(),
			page: () => void askPage('next'),
			map: () => void toggleMap(),
			view: () => void askViewFlip(),
			camera: () => void askCamera(),
			photo: () => void askPhoto(),
		},
	);

	const sayGear = () => {
		const s = workout();
		const r = road();
		const answer = s
			? shiftAnswer(s, { bias: s.bias })
			: r
				? shiftAnswer(r.solo, null)
				: null;
		if (answer) riderLane.sendGear(answer);
	};
	const sayPause = () => {
		if (riding()) riderLane.sendPause(pauseOf(workout()));
	};
	const sayView = () => {
		if (riding()) riderLane.sendView(viewNow());
	};
	$effect(sayGear);
	$effect(sayPause);
	$effect(sayView);
	$effect(() => {
		const off = riderLane.onRemote((cmd) => {
			remote.run(cmd);
			if (cmd.action === 'talk-keepalive') return;
			sayGear();
			sayPause();
			// A page or view press is answered by sayView's effect once the
			// screen has turned (connection.svelte.ts says why).
			if (cmd.action === 'sync') sayView();
		});
		return () => {
			off();
			remote.stop();
		};
	});
}
