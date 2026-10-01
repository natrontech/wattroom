import { DEFAULTS, type GuardSample } from './guards';
import type { createRideRecord } from './ride-record.svelte';
import type { createRiderGuards } from './rider-guards.svelte';
import type { RideState } from './ride-state';

/**
 * The rider guards wired into a solo ride: auto-pause and the spiral release
 * (#788), and the ride that ends itself once its rider has gone (#2622).
 * What the trainer has to be told, they say through `actuate`.
 */
export function wireSoloGuards(
	guards: ReturnType<typeof createRiderGuards>,
	ride: {
		state: () => RideState;
		/** The PRESCRIBED target: the one the trainer holds is zero exactly
		 *  when a guard is already up. */
		prescribed: () => number;
		actuate: () => void;
		record: Pick<ReturnType<typeof createRideRecord>, 'trimStoppedTail'>;
		end: () => void;
	},
) {
	return {
		/**
		 * One sample, judged before the record keeps it, so the second that
		 * trips a guard is stamped as the guard's (#1796). The guards count
		 * seconds and a trainer notifies more than once a second, so only the
		 * sample that opens one counts it (#1798). Says whether the rider is
		 * pedalling.
		 */
		sample(next: GuardSample, opensSecond: boolean): boolean {
			const pedalling = guards.pedalling(next);
			if (
				ride.state() !== 'idle' &&
				guards.sample(next, ride.prescribed(), opensSecond ? 1 : 0)
			)
				ride.actuate();
			return pedalling;
		},
		/**
		 * The guards' share of a ride second. True when the second was theirs —
		 * counting back in, auto-paused, or not riding at all — and the
		 * workout clock stays where it is.
		 */
		tick(seconds: number): boolean {
			const state = ride.state();
			if (state === 'resuming') {
				if (guards.tick(seconds)) ride.actuate();
				return true;
			}
			// Stopped long enough that the rider has gone (#2622): the ride ends
			// itself, and the stopped run is not part of it.
			if (state === 'autopaused') {
				if (guards.stoppedFor(seconds) >= DEFAULTS.stoppedEndsAfterSeconds) {
					ride.record.trimStoppedTail(guards.pedalling);
					ride.end();
				}
				return true;
			}
			if (state !== 'running') return true;
			if (guards.spiralActive && guards.tick(seconds)) ride.actuate();
			return false;
		},
	};
}
