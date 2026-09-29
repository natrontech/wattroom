/**
 * The plane geometry the placement gates measure with (#3219): distances
 * between segments and convex polygons, containment, and the area two
 * convex footprints share. x east, z south, metres.
 */
export type P2 = readonly [number, number];

const sub = (a: P2, b: P2): [number, number] => [a[0] - b[0], a[1] - b[1]];
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];

export function pointSegment(p: P2, a: P2, b: P2): number {
	const ab = sub(b, a);
	const len2 = dot(ab, ab) || 1e-12;
	const t = Math.min(Math.max(dot(sub(p, a), ab) / len2, 0), 1);
	return Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]);
}

function segmentsCross(a: P2, b: P2, c: P2, d: P2): boolean {
	const d1 = cross(sub(b, a), sub(c, a));
	const d2 = cross(sub(b, a), sub(d, a));
	const d3 = cross(sub(d, c), sub(a, c));
	const d4 = cross(sub(d, c), sub(b, c));
	return d1 * d2 < 0 && d3 * d4 < 0;
}

export function segmentSegment(a: P2, b: P2, c: P2, d: P2): number {
	if (segmentsCross(a, b, c, d)) return 0;
	return Math.min(
		pointSegment(a, c, d),
		pointSegment(b, c, d),
		pointSegment(c, a, b),
		pointSegment(d, a, b),
	);
}

/** Inside a convex or concave polygon (even-odd). */
export function inside(p: P2, poly: readonly P2[]): boolean {
	let odd = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, zi] = poly[i];
		const [xj, zj] = poly[j];
		if (
			zi > p[1] !== zj > p[1] &&
			p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi
		)
			odd = !odd;
	}
	return odd;
}

const edges = (poly: readonly P2[]) =>
	poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as const);

/** The closest a polygon comes to a polyline; 0 where they touch or cross. */
export function polygonPolyline(
	poly: readonly P2[],
	line: readonly P2[],
): number {
	if (line.some((p) => inside(p, poly))) return 0;
	let best = Infinity;
	for (const [a, b] of edges(poly))
		for (let k = 0; k < line.length - 1; k++)
			best = Math.min(best, segmentSegment(a, b, line[k], line[k + 1]));
	return best;
}

/** The closest two polygons come; 0 where they overlap. */
export function polygonPolygon(a: readonly P2[], b: readonly P2[]): number {
	if (a.some((p) => inside(p, b)) || b.some((p) => inside(p, a))) return 0;
	let best = Infinity;
	for (const [p, q] of edges(a))
		for (const [r, s] of edges(b))
			best = Math.min(best, segmentSegment(p, q, r, s));
	return best;
}

export function area(poly: readonly P2[]): number {
	let s = 0;
	for (const [a, b] of edges(poly)) s += cross(a, b);
	return Math.abs(s) / 2;
}

/** The area two convex polygons share (Sutherland–Hodgman), m². */
export function overlapArea(a: readonly P2[], b: readonly P2[]): number {
	const sign = Math.sign(cross(sub(b[1], b[0]), sub(b[2], b[1]))) || 1;
	let out: P2[] = [...a];
	for (const [c, d] of edges(b)) {
		const inputs = out;
		out = [];
		const keep = (p: P2) => sign * cross(sub(d, c), sub(p, c)) >= 0;
		for (let i = 0; i < inputs.length; i++) {
			const p = inputs[i];
			const q = inputs[(i + 1) % inputs.length];
			const pIn = keep(p);
			const qIn = keep(q);
			if (pIn) out.push(p);
			if (pIn !== qIn) {
				const dp = sign * cross(sub(d, c), sub(p, c));
				const dq = sign * cross(sub(d, c), sub(q, c));
				const t = dp / (dp - dq);
				out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
			}
		}
		if (out.length === 0) return 0;
	}
	return area(out);
}

/** Where the gates sample a footprint: its corners, the middle of each edge, and its centre. */
export function samples(poly: readonly P2[]): P2[] {
	const c: P2 = [
		poly.reduce((s, p) => s + p[0], 0) / poly.length,
		poly.reduce((s, p) => s + p[1], 0) / poly.length,
	];
	return [
		...poly,
		...edges(poly).map(
			([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as P2,
		),
		c,
	];
}

export const centroid = (poly: readonly P2[]): P2 => samples(poly).at(-1)!;
