/**
 * The landing's "try the sprint" toy (#2995): taps become watts. Pure, so the
 * arithmetic has a test and the component is only wiring. None of these are
 * product numbers — a keyboard is not a trainer — they are tuned so ten taps
 * a second reads like a strong amateur's sprint.
 */
export const SPRINT = {
	/** Watts each tap in the last second is worth. */
	perTap: 110,
	/** The ceiling, however fast the thumbs. */
	max: 1600,
	/** Holding the pad instead of mashing it: the no-mash way to play. */
	hold: 850,
	/** How long a press lasts before it counts as holding, ms. */
	holdAfter: 300,
	/** How fast power follows the target, ms (a flywheel, not a switch). */
	tau: 250,
	/** The sprint itself and the klaxon before it, ms. */
	length: 10_000,
	warning: 3_000,
	/** One sample every this many ms; five seconds of them is the score. */
	sampleEvery: 100,
} as const;

/** The watts the pad is asking for at `now`. */
export function target(
	taps: number[],
	now: number,
	pressedSince: number | null,
): number {
	const recent = taps.filter((t) => now - t < 1000).length;
	const tapped = Math.min(SPRINT.max, recent * SPRINT.perTap);
	const holding =
		pressedSince !== null && now - pressedSince >= SPRINT.holdAfter
			? SPRINT.hold
			: 0;
	return Math.max(tapped, holding);
}

/** Power after `dt` ms of chasing `goal`. */
export function follow(power: number, goal: number, dt: number): number {
	return power + (goal - power) * (1 - Math.exp(-dt / SPRINT.tau));
}

/** The best five-second average in a run of evenly spaced samples. */
export function bestFive(samples: number[]): number {
	const n = 5000 / SPRINT.sampleEvery;
	if (samples.length === 0) return 0;
	if (samples.length < n)
		return Math.round(samples.reduce((a, b) => a + b, 0) / n);
	let sum = samples.slice(0, n).reduce((a, b) => a + b, 0);
	let best = sum;
	for (let i = n; i < samples.length; i++) {
		sum += samples[i] - samples[i - n];
		best = Math.max(best, sum);
	}
	return Math.round(best / n);
}
