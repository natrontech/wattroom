import { zoneOf } from '$lib/components/zones';

/**
 * Post-ride numbers for the session summary (#39's design), computed from the
 * rider's own 1 Hz samples. Formulas are docs/SPEC.md's or the sport's
 * standards — nothing invented here.
 */
export interface RideSample {
	watts: number;
}

/** Seconds spent in each Coggan zone (index 1-7; 0 unused). */
export function zoneSeconds(samples: RideSample[], ftp: number): number[] {
	const out = [0, 0, 0, 0, 0, 0, 0, 0];
	for (const sample of samples) {
		if (sample.watts <= 0) continue;
		out[zoneOf(sample.watts, ftp)] += 1;
	}
	return out;
}

/** Best rolling averages for the SPEC curve windows; short rides honestly 0. */
export function curvePoints(
	samples: RideSample[],
): { label: string; watts: number }[] {
	const watts = samples.map((s) => s.watts);
	const best = (window: number): number => {
		if (watts.length < window) return 0;
		let sum = 0;
		for (let i = 0; i < window; i++) sum += watts[i];
		let top = sum;
		for (let i = window; i < watts.length; i++) {
			sum += watts[i] - watts[i - window];
			if (sum > top) top = sum;
		}
		return Math.round(top / window);
	};
	return [
		{ label: '5 s', watts: best(5) },
		{ label: '1 min', watts: best(60) },
		{ label: '5 min', watts: best(300) },
		{ label: '20 min', watts: best(1200) },
	];
}

/**
 * Normalised power: 30 s rolling average, fourth power, mean, fourth root —
 * the standard Coggan definition. Under 30 s of riding it is just the average.
 */
export function normalizedPower(samples: RideSample[]): number {
	const watts = samples.map((s) => s.watts);
	if (watts.length === 0) return 0;
	if (watts.length < 30) {
		return Math.round(watts.reduce((a, b) => a + b, 0) / watts.length);
	}
	let sum = 0;
	for (let i = 0; i < 30; i++) sum += watts[i];
	let fourthSum = 0;
	let count = 0;
	for (let i = 30; i <= watts.length; i++) {
		fourthSum += Math.pow(sum / 30, 4);
		count++;
		if (i < watts.length) sum += watts[i] - watts[i - 30];
	}
	return Math.round(Math.pow(fourthSum / count, 0.25));
}

/** docs/SPEC.md XP: 1 kJ = 1 XP plus execution% × 50. Streak lands server-side. */
export function rideXp(kj: number, execution: number): number {
	return kj + Math.round(execution * 50);
}
