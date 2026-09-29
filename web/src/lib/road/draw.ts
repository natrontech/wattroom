/**
 * A road drawn as SVG path data: from above, north up, and its heights by
 * distance. The dev page and the importer's preview draw the same lines
 * (#3057), so the fitting lives here once.
 */

/** The line from above, fitted to w × h with its aspect kept and `pad` clear. */
export function planPath(
	x: ArrayLike<number>,
	z: ArrayLike<number>,
	w: number,
	h: number,
	pad = 10,
): string {
	const [x0, x1] = [Math.min(...Array.from(x)), Math.max(...Array.from(x))];
	const [z0, z1] = [Math.min(...Array.from(z)), Math.max(...Array.from(z))];
	const k = Math.min(
		(w - 2 * pad) / (x1 - x0 || 1),
		(h - 2 * pad) / (z1 - z0 || 1),
	);
	// Centred in whichever axis has room to spare.
	const ox = (w - (x1 - x0) * k) / 2;
	const oz = (h - (z1 - z0) * k) / 2;
	return Array.from(
		x,
		(xi, i) =>
			`${i ? 'L' : 'M'}${(ox + (xi - x0) * k).toFixed(1)} ${(oz + (z[i] - z0) * k).toFixed(1)}`,
	).join(' ');
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
