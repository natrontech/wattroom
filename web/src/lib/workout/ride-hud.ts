import type { TrainerSample } from '$lib/ble/trainer';
import { publishHud } from '$lib/hud/feed';
import type { RoadReadout } from '$lib/road/readout';
import { signalLost, type RideState } from './ride-state';

/**
 * A solo ride's HUD feed (ADR-0041, #1665): the session publishes, not the
 * screen, so the floating window follows the ride off /ride — and carries
 * the fault the screen would be shouting about.
 */
export function createRideHud(ride: {
	label: string;
	state: () => RideState;
	sample: () => TrainerSample | null;
	target: () => number;
	remaining: () => number;
	ridingSince: () => number | undefined;
	now: () => number;
	/** Where on its road, for a ride on one (#3639). */
	road?: () => RoadReadout | undefined;
}) {
	return function publish() {
		const state = ride.state();
		if (state === 'idle' || state === 'countdown' || state === 'done') return;
		const sample = ride.sample();
		publishHud({
			watts: sample?.watts ?? 0,
			target: ride.target(),
			remaining: Math.max(0, ride.remaining()),
			label: ride.label,
			road: ride.road?.(),
			// The rule both riding pages draw their banner from (#2158) — the
			// HUD used to need a first sample, so the rider who alt-tabbed
			// away from a trainer that never sends watts had the one surface
			// they were looking at saying nothing at all (#2200).
			fault: signalLost({ state, sample }, ride.ridingSince(), ride.now())
				? 'trainer'
				: undefined,
		});
	};
}
