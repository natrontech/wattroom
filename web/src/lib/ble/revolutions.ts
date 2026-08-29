/**
 * Cadence from cumulative crank revolutions.
 *
 * Both the Cycling Power (0x2A63) and Cycling Speed and Cadence (0x2A5B) profiles
 * report cadence the same indirect way: a running count of crank revolutions plus
 * the time of the last crank event. Rate is the difference between two packets,
 * which is why this needs state and cannot be a pure parse.
 *
 * Settles the "0x2A63 crank-revolution rollover math + stale-data thresholds" item
 * from docs/RESEARCH.md §11. Three traps, all of them silent:
 *
 *   - Both counters are uint16 and wrap. Naive subtraction gives a huge negative
 *     revolution delta, or a negative time delta that flips cadence to nonsense.
 *   - The event time only advances when the crank turns. A stopped rider produces
 *     identical packets forever, so "no change" has to become zero on a wall clock
 *     rather than being read as "cadence unchanged".
 *   - A very small time delta divides into an absurd rpm. Clamped, because a bad
 *     packet must not be able to fire the spiral guard or score a ride.
 */
export const REVOLUTION = {
	/** Both counters are uint16. */
	rollover: 0x10000,
	/** Crank event time resolution, in both profiles: 1/1024 s. */
	ticksPerSecond: 1024,
	/**
	 * No crank event for this long and the rider has stopped. 30 rpm is one event
	 * every two seconds, so nothing slower than that is pedalling. Tune in alpha,
	 * the way session.svelte.ts marks its own defaults.
	 */
	staleSeconds: 3,
	/** Above this, the packet is noise rather than a person. */
	maxRpm: 250,
} as const;

export interface RevolutionSample {
	/** Cumulative crank revolutions, uint16. */
	revs: number;
	/** Time of last crank event, uint16, 1/1024 s. */
	eventTime: number;
}

/** Difference between two uint16 counters, accounting for wraparound. */
export function delta(previous: number, current: number): number {
	return (current - previous + REVOLUTION.rollover) % REVOLUTION.rollover;
}

/**
 * Tracks one sensor's crank data across packets and reports rpm.
 *
 * Built per connection, so a reconnect can never compute a rate across the gap.
 */
export function createCadenceTracker(now: () => number = Date.now) {
	let previous: RevolutionSample | undefined;
	let lastEventAt = 0;
	let cadence = 0;

	return function update(next: RevolutionSample): number {
		const at = now();
		if (!previous) {
			previous = next;
			lastEventAt = at;
			// One sample is a count, not a rate.
			return 0;
		}

		const ticks = delta(previous.eventTime, next.eventTime);
		if (ticks === 0) {
			// Nothing new since the last packet: the crank has not turned. Sensors
			// repeat the same values indefinitely, so only the wall clock can tell
			// "briefly between events" from "stopped".
			if (at - lastEventAt >= REVOLUTION.staleSeconds * 1000) cadence = 0;
			return cadence;
		}

		const revs = delta(previous.revs, next.revs);
		previous = next;
		lastEventAt = at;

		const rpm = (revs * 60 * REVOLUTION.ticksPerSecond) / ticks;
		cadence = Math.round(Math.min(rpm, REVOLUTION.maxRpm));
		return cadence;
	};
}
