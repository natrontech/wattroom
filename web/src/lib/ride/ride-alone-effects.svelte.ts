import { hwlog } from '$lib/ble/hwlog';
import { createRideFlags } from '$lib/ride/flags.svelte';
import type { RoadAlone } from '$lib/ride/road-alone.svelte';
import { createRideSounds, soloRideSounds } from '$lib/ride/ride-sounds.svelte';
import type { createRideSession } from '$lib/workout/session.svelte';
import { createSignalWatch } from '$lib/workout/signal-watch.svelte';

type Session = ReturnType<typeof createRideSession>;

/**
 * What the device's one ride alone runs beside it (ADR-0093): the ⚑, the
 * signal watch, the cues, the unload guard and the save once it is done, in
 * an effect root of their own above the router, so no page's unmount stops
 * them. Made once, on the first ride.
 */
export function holdRideAloneEffects(ride: {
	session: () => Session | null;
	road: () => RoadAlone | null;
	save: (session: Session) => void;
}) {
	let held!: {
		flags: ReturnType<typeof createRideFlags>;
		signal: ReturnType<typeof createSignalWatch>;
	};
	$effect.root(() => {
		// The ⚑ and what it sends afterwards (#52), shared with /ramp.
		const flags = createRideFlags('/ride');
		const signal = createSignalWatch(ride.session);
		held = { flags, signal };

		// What the ride says out loud (#1792): the cues a session plays for its
		// riders, from the session's own state, the same wiring as /ramp's (#3359).
		createRideSounds(soloRideSounds(ride.session, () => signal.lost));

		// Guard telemetry for #46: the hardware session has to produce evidence,
		// not an anecdote. Dev-only via hwlog.
		let sawSpiral = false;
		let sawState: string | null = null;
		$effect(() => {
			const current = ride.session();
			if (!current) return;
			if (current.spiralActive !== sawSpiral) {
				sawSpiral = current.spiralActive;
				hwlog('spiral-guard', {
					active: sawSpiral,
					watts: current.sample?.watts,
					cadence: current.sample?.cadence,
					target: current.target,
					elapsed: current.elapsed,
				});
			}
			if (current.state !== sawState) {
				sawState = current.state;
				hwlog('ride-state', { state: sawState, elapsed: current.elapsed });
			}
		});

		// Navigation never ends the ride (ADR-0093), but a closed tab does: the
		// browser asks first while there is a ride to lose (#126). The count-in
		// has nothing ridden yet (#1800). A closed tab sends the flags on its
		// way out (#2619).
		$effect(() => {
			const unload = (event: BeforeUnloadEvent) => {
				const state = ride.session()?.state;
				if (
					(state &&
						state !== 'idle' &&
						state !== 'countdown' &&
						state !== 'done') ||
					ride.road()?.solo.trainer
				)
					event.preventDefault();
			};
			const hide = () => flags.flush(true);
			window.addEventListener('beforeunload', unload);
			window.addEventListener('pagehide', hide);
			return () => {
				window.removeEventListener('beforeunload', unload);
				window.removeEventListener('pagehide', hide);
			};
		});

		// A finished ride is worth keeping even if the rider never exports it:
		// on the account (#110, one history feeding streaks and XP), with the
		// device store as the fallback when the server is unreachable.
		$effect(() => {
			const current = ride.session();
			if (current?.state === 'done') ride.save(current);
		});
	});
	return held;
}
