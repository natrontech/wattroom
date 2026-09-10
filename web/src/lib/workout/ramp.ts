import type { Workout } from './types';

/**
 * The ramp test, built as a normal workout on the existing engine (WATTROOM.md).
 *
 * It uses absolute watts rather than %FTP, which is the whole reason `SteadyStep`
 * carries a `watts` field: a ramp test measures the number every other workout
 * scales to, so it cannot scale to it.
 *
 * Every number here is docs/SPEC.md's — do not tune them in code.
 */
export const RAMP = {
	startWatts: 100,
	stepWatts: 20,
	stepSeconds: 60,
	/** 25 steps reaches 580 W — past any rider who needs a test to find out. */
	steps: 25,
	ftpFraction: 0.75,
	/**
	 * Failure detection (docs/SPEC.md). A rider at the end of a ramp is not going to
	 * press a button, so the test has to notice for them.
	 */
	failFraction: 0.75,
	failSeconds: 5,
	/** Eases the rider in and gives the trainer time to settle before it counts. */
	warmupSeconds: 300,
	/**
	 * Steps that must be completed for the result to mean anything. A rider who stops
	 * during the warmup would otherwise be offered an FTP derived from warmup power —
	 * and FTP scales every workout, so accepting it silently ruins the whole library.
	 */
	minSteps: 2,
} as const;

/**
 * How long the test takes, said the same way on every surface that offers it
 * (#1799: /ramp said 12–18, /workouts and /settings/equipment said 20). Not a
 * SPEC number — it is where riders tend to fail: five minutes of warm-up plus
 * seven to thirteen steps.
 */
export const RAMP_TAKES = 'about 12–18 minutes';

/**
 * Is the result meaningful? A ramp abandoned in the warmup produces arithmetic, not
 * a measurement, and offering to save it is worse than offering nothing.
 */
export function rampUsable(elapsedSeconds: number): boolean {
	return (
		elapsedSeconds >= RAMP.warmupSeconds + RAMP.minSteps * RAMP.stepSeconds
	);
}

export function buildRampTest(): Workout {
	return {
		name: 'Ramp test',
		author: 'wattroom',
		// The ride is kept and paid in XP, but not scored (#1400): a ramp is
		// ridden in ERG against its own climbing target, so an execution score
		// says the trainer held the wattage, never how the rider went.
		unscored: true,
		steps: [
			{ type: 'warmup', seconds: RAMP.warmupSeconds, from: 0.35, to: 0.5 },
			...Array.from({ length: RAMP.steps }, (_, i) => ({
				type: 'steady' as const,
				seconds: RAMP.stepSeconds,
				watts: RAMP.startWatts + i * RAMP.stepWatts,
			})),
		],
	};
}

/**
 * Highest 60-second rolling average in the ride.
 *
 * Rolling rather than per-step: a rider almost always fails partway through a step,
 * and their best minute straddles the boundary. Taking the last completed step would
 * systematically under-report — by up to a full 20 W increment.
 */
export function bestOneMinute(watts: number[]): number {
	if (watts.length === 0) return 0;
	const window = Math.min(60, watts.length);
	let sum = 0;
	for (let i = 0; i < window; i++) sum += watts[i];
	let best = sum;
	for (let i = window; i < watts.length; i++) {
		sum += watts[i] - watts[i - window];
		if (sum > best) best = sum;
	}
	return Math.round(best / window);
}

/** docs/SPEC.md: FTP is 75 % of the best one-minute power. */
export function ftpFromRamp(watts: number[]): { ftp: number; best: number } {
	const best = bestOneMinute(watts);
	return { best, ftp: Math.round(best * RAMP.ftpFraction) };
}

/**
 * The page's decision: blown only once the warm-up is over. The warm-up has a
 * target too, and the detector used to fire five seconds into a test on a
 * rider still spinning up (audit 2026-09-09).
 */
export function rampBlown(
	elapsedSeconds: number,
	recent: { watts: number; target: number }[],
	/**
	 * Two windows that look like a rider blowing up and are not (#1794):
	 * `released` while the spiral guard has dropped the target on purpose, and
	 * `stale` while no sample has landed — a dropout freezes the recording
	 * while the clock, and the target stamped on those rows, keeps climbing.
	 */
	{ released = false, stale = false } = {},
): boolean {
	if (released || stale) return false;
	return elapsedSeconds >= RAMP.warmupSeconds && rampFailed(recent);
}

/**
 * Has the rider blown? True once power has sat well under target for long enough.
 * The caller passes the trailing samples; keeping the decision pure makes it
 * testable without a trainer.
 */
export function rampFailed(
	recent: { watts: number; target: number }[],
): boolean {
	if (recent.length < RAMP.failSeconds) return false;
	return recent
		.slice(-RAMP.failSeconds)
		.every((s) => s.target > 0 && s.watts < s.target * RAMP.failFraction);
}
