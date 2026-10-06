/**
 * A road drawn as SVG path data: from above, north up, and its heights by
 * distance. The dev page and the importer's preview draw the same lines
 * (#3057), so the fitting lives here once.
 */

import { gradeStep } from './skyline';

export type Point = [number, number];

/** The line from above, fitted to w × h with its aspect kept and `pad` clear. */
export function planPoints(
	x: ArrayLike<number>,
	z: ArrayLike<number>,
	w: number,
	h: number,
	pad = 10,
): Point[] {
	const [x0, x1] = [Math.min(...Array.from(x)), Math.max(...Array.from(x))];
	const [z0, z1] = [Math.min(...Array.from(z)), Math.max(...Array.from(z))];
	const k = Math.min(
		(w - 2 * pad) / (x1 - x0 || 1),
		(h - 2 * pad) / (z1 - z0 || 1),
	);
	// Centred in whichever axis has room to spare.
	const ox = (w - (x1 - x0) * k) / 2;
	const oz = (h - (z1 - z0) * k) / 2;
	return Array.from(x, (xi, i): Point => [
		ox + (xi - x0) * k,
		oz + (z[i] - z0) * k,
	]);
}

const pathOf = (points: Point[]): string =>
	points
		.map(([px, pz], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${pz.toFixed(1)}`)
		.join(' ');

export function planPath(
	x: ArrayLike<number>,
	z: ArrayLike<number>,
	w: number,
	h: number,
	pad = 10,
): string {
	return pathOf(planPoints(x, z, w, h, pad));
}

/**
 * A drawn line walked by its own length, so a road's metres land on its
 * shape whatever the shape was sampled at: the importer's Route samples
 * every few metres, a stored route's polyline wherever it bends (#3679).
 */
export function walk(points: Point[]) {
	const at = [0];
	for (let i = 1; i < points.length; i++)
		at.push(
			at[i - 1] +
				Math.hypot(
					points[i][0] - points[i - 1][0],
					points[i][1] - points[i - 1][1],
				),
		);
	const total = at[at.length - 1] || 1;
	const index = (f: number) => {
		const d = Math.min(1, Math.max(0, f)) * total;
		let i = 1;
		while (i < at.length - 1 && at[i] < d) i++;
		const span = at[i] - at[i - 1] || 1;
		return { i, t: (d - at[i - 1]) / span };
	};
	const point = (f: number): Point => {
		const { i, t } = index(f);
		const [a, b] = [points[i - 1], points[i]];
		return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
	};
	return {
		/** Where the fraction f of the line's length falls. */
		point,
		/** Path data from fraction f0 to f1 of the line. */
		between(f0: number, f1: number): string {
			const { i: i0 } = index(f0);
			const { i: i1 } = index(f1);
			return pathOf([point(f0), ...points.slice(i0, i1), point(f1)]);
		},
	};
}

/**
 * Circled km ticks along a road (#3679): every 10 km, every 5 km under 20 km,
 * none under 5 km. In km, inside the road, never on its ends.
 */
export function kmTicks(lengthM: number): number[] {
	const km = lengthM / 1000;
	const every = km < 5 ? 0 : km < 20 ? 5 : 10;
	const out: number[] = [];
	for (let k = every; every && k < km; k += every) out.push(k);
	return out;
}

/** Heights by distance across w, lowest at the bottom, `pad` clear top and bottom. */
export function profilePath(
	heights: number[],
	w: number,
	h: number,
	pad = 10,
): string {
	const [lo, hi] = [Math.min(...heights), Math.max(...heights)];
	return heights
		.map(
			(e, i) =>
				`${i ? 'L' : 'M'}${((i / (heights.length - 1)) * w).toFixed(1)} ${(h - pad - ((e - lo) / (hi - lo || 1)) * (h - 2 * pad)).toFixed(1)}`,
		)
		.join(' ');
}

/**
 * The area under a profile, cut into runs of one grade step: each run a
 * polygon down to the bottom of w × h, to fill with GRADE_FILL[step] (#3679).
 * Grades are the road's own, sample to sample.
 */
export function profileArea(
	heights: number[],
	lengthM: number,
	w: number,
	h: number,
	pad = 10,
): { step: number; d: string }[] {
	const [lo, hi] = [Math.min(...heights), Math.max(...heights)];
	const n = heights.length - 1;
	const stepM = lengthM / (n || 1);
	const px = (i: number) => (i / (n || 1)) * w;
	const py = (e: number) =>
		h - pad - ((e - lo) / (hi - lo || 1)) * (h - 2 * pad);
	const runs: { step: number; d: string }[] = [];
	let from = 0;
	const close = (to: number, step: number) => {
		const top = [];
		for (let i = from; i <= to; i++)
			top.push(`L${px(i).toFixed(1)} ${py(heights[i]).toFixed(1)}`);
		runs.push({
			step,
			d: `M${px(from).toFixed(1)} ${h} ${top.join(' ')} L${px(to).toFixed(1)} ${h} Z`,
		});
		from = to;
	};
	for (let i = 0; i < n; i++) {
		const step = gradeStep(((heights[i + 1] - heights[i]) / stepM) * 100);
		const next =
			i + 1 < n
				? gradeStep(((heights[i + 2] - heights[i + 1]) / stepM) * 100)
				: null;
		if (next !== step) close(i + 1, step);
	}
	return runs;
}
