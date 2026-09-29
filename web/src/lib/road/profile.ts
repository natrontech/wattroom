/**
 * A road's heights and turns, from its resampled line (#3023). The numbers
 * are docs/SPEC.md "Route rides"'s.
 */
import * as protocol from '$lib/protocol';

/**
 * Heights: a 200 m rolling median, then a 120 m moving average. The median
 * takes out what a height model gets wrong for less than half its window — a
 * bridge the model drops into the valley under it, a tunnel it lifts over the
 * hill above — and the average smooths the steps GPS altitude leaves.
 */
export const MEDIAN_M = 200;
export const AVERAGE_M = 120;

export function rollingMedian(a: Float64Array, half: number): Float64Array {
	const out = new Float64Array(a.length);
	for (let i = 0; i < a.length; i++) {
		const w = Array.from(
			a.subarray(Math.max(0, i - half), Math.min(a.length, i + half + 1)),
		).sort((p, q) => p - q);
		const m = w.length >> 1;
		out[i] = w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2;
	}
	return out;
}

export function movingAverage(a: Float64Array, half: number): Float64Array {
	const out = new Float64Array(a.length);
	for (let i = 0; i < a.length; i++) {
		let s = 0;
		let c = 0;
		const hi = Math.min(a.length - 1, i + half);
		for (let k = Math.max(0, i - half); k <= hi; k++) {
			s += a[k];
			c++;
		}
		out[i] = s / c;
	}
	return out;
}

/**
 * Holds every step of the road to the stored grade range, and rebuilds the
 * heights from the held steps, so the heights and the grade they imply never
 * disagree: a road stored as heights alone still carries no step past it.
 */
export function holdGrade(ele: Float64Array, step: number): Float64Array {
	const lo = (protocol.MinRoadGradePct / 100) * step;
	const hi = (protocol.MaxRoadGradePct / 100) * step;
	const out = new Float64Array(ele.length);
	out[0] = ele[0];
	for (let i = 1; i < ele.length; i++)
		out[i] = out[i - 1] + Math.min(hi, Math.max(lo, ele[i] - ele[i - 1]));
	return out;
}

/** Percent at each sample, from its neighbours. */
export function gradeOf(ele: Float64Array, step: number): Float64Array {
	const n = ele.length;
	const out = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const a = Math.max(0, i - 1);
		const b = Math.min(n - 1, i + 1);
		out[i] = b > a ? ((ele[b] - ele[a]) / ((b - a) * step)) * 100 : 0;
	}
	return out;
}

/** The heading is smoothed over this before its change is taken. */
export const TURN_M = 100;
/** A turn is stored as an int8, in whole degrees. */
const INT8 = 127;

/**
 * The road's turns, one per `every` samples: how far its heading swings from
 * one stored sample to the next, in whole degrees, positive to the right (a
 * compass bearing growing). The heading is smoothed over TURN_M first, so a
 * 9 m hairpin's 180° spreads over about 100 m and fits an int8 per 20 m step,
 * and the sum of any run of turns is how far the road turned along it — which
 * is what finds a hairpin, and what draws a plausible road for a rider who is
 * sent only heights and turns (ADR-0063).
 */
export function turnsOf(
	x: Float64Array,
	z: Float64Array,
	step: number,
	every: number,
): number[] {
	const n = x.length;
	// Bearing of each segment, unwrapped so a smoothing window never averages
	// across the ±180° seam.
	const bearing = new Float64Array(n - 1);
	for (let i = 0; i < n - 1; i++) {
		const b = Math.atan2(x[i + 1] - x[i], z[i] - z[i + 1]);
		if (i === 0) bearing[i] = b;
		else {
			const d = b - bearing[i - 1];
			bearing[i] = b - 2 * Math.PI * Math.round(d / (2 * Math.PI));
		}
	}
	const smooth = movingAverage(
		bearing,
		Math.max(1, Math.round(TURN_M / step / 2)),
	);
	const turns: number[] = [];
	for (let i = 0; i + every < n; i += every) {
		// Segment i leaves sample i; the last sample has no segment of its own.
		const to = Math.min(i + every, n - 2);
		const deg = ((smooth[to] - smooth[i]) * 180) / Math.PI;
		turns.push(Math.max(-INT8, Math.min(INT8, Math.round(deg))));
	}
	return turns;
}

/** Metres climbed over the heights. */
export function gainOf(ele: ArrayLike<number>): number {
	let gain = 0;
	for (let i = 1; i < ele.length; i++) gain += Math.max(0, ele[i] - ele[i - 1]);
	return gain;
}

/**
 * The name every surface but the owner's shows (ADR-0063): numbers only, until
 * the geo pack can name places outside every privacy zone.
 */
export function roadName(lengthM: number, gainM: number): string {
	const km = (lengthM / 1000).toFixed(1);
	const up = Math.round(gainM).toLocaleString('en-US');
	return `Road · ${km} km · ${up} m`;
}
