import { referenceSpeed } from '$lib/road/pace';
import type { Line } from '../terrain/lines';
import { walker } from './roads';

/**
 * A stroke's riding clock (#3077): seconds from its canonical start at the
 * reference rider's uphill pace at |grade| — what the set pieces are spaced
 * by, so a climber meets the rhythm the SPEC sets and a descender meets the
 * same objects sooner — and at the faster direction's pace, what #3221's O9
 * measures them by. Both are functions of the stroke alone.
 */
export function rhythmOf(line: Line, step = 10) {
	const w = walker(line);
	const n = Math.max(2, Math.floor(w.length / step) + 1);
	const up = new Float64Array(n);
	const fast = new Float64Array(n);
	let h0 = w.at(0).h;
	for (let i = 1; i < n; i++) {
		const h = w.at(i * step).h;
		const g = ((h - h0) / step) * 100;
		const climbing = referenceSpeed(g < 0 ? -g : g);
		const falling = referenceSpeed(g < 0 ? g : -g);
		up[i] = up[i - 1] + step / climbing;
		fast[i] = fast[i - 1] + step / (climbing > falling ? climbing : falling);
		h0 = h;
	}
	const read = (a: Float64Array, s: number) => {
		const f = Math.min(Math.max(s / step, 0), n - 1);
		const i = Math.min(Math.floor(f), n - 2);
		return a[i] + (a[i + 1] - a[i]) * (f - i);
	};
	/** The metre along the stroke where the uphill clock reads `t`. */
	function at(t: number): number {
		let lo = 0;
		let hi = n - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (up[mid] < t) lo = mid;
			else hi = mid;
		}
		const span = up[hi] - up[lo] || 1;
		return (lo + Math.min(1, Math.max(0, (t - up[lo]) / span))) * step;
	}
	return {
		walk: w,
		length: w.length,
		/** The uphill clock's whole reading, start to end. */
		total: up[n - 1],
		up: (s: number) => read(up, s),
		fast: (s: number) => read(fast, s),
		at,
	};
}
