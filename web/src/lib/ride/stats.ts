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

/** docs/SPEC.md: under this the rolling-4th-power estimate is not meaningful. */
const NP_MIN_SECONDS = 20 * 60;

/**
 * Normalised power: 30 s rolling average, fourth power, mean, fourth root —
 * the standard Coggan definition. Under 20 minutes it is the plain average,
 * as the server stores it (docs/SPEC.md) — the two used to part company on
 * every ride between 30 s and 20 min, both labelled "normalised" (#1542).
 */
export function normalizedPower(samples: RideSample[]): number {
	const watts = samples.map((s) => s.watts);
	if (watts.length === 0) return 0;
	if (watts.length < NP_MIN_SECONDS) {
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

/**
 * The ride as one SVG path against the FTP line (#1559): peak watts per
 * bucket, one point per bucket so a two-hour ride is under 300 nodes, the
 * top of the box the higher of 1.2 × FTP and the ride's own peak. Null when
 * there is nothing to draw.
 */
export function powerTrace(
	samples: RideSample[],
	ftp: number,
	width: number,
	height: number,
): { path: string; ftpY: number; top: number } | null {
	if (samples.length < 2) return null;
	const bucket = Math.max(1, Math.ceil(samples.length / 300));
	const points: number[] = [];
	for (let i = 0; i < samples.length; i += bucket) {
		let peak = 0;
		for (let j = i; j < Math.min(i + bucket, samples.length); j++)
			peak = Math.max(peak, samples[j].watts);
		points.push(peak);
	}
	const top = Math.max(ftp * 1.2, ...points);
	const x = (i: number) => (i / (points.length - 1)) * width;
	const y = (w: number) => height - (w / top) * height;
	const path = points
		.map(
			(w, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(w).toFixed(1)}`,
		)
		.join(' ');
	return { path, ftpY: y(ftp), top };
}
