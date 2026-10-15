import type { P2 } from './geom';

/**
 * The render gates (#3220), beside the placement gates: what the camera's
 * depth range, the sightline and the draw rings owe the rider. Pure, so a
 * test reads the world's own constants and feeds them in. The numbers are
 * the issue's (docs/SPEC.md proposals, defaults: tune in alpha).
 */
// prettier-ignore
export const RENDER_GATES = {
	/** O6: a depth buffer's bits, the least near plane, the margin over one depth step, and how close counts as coplanar. */
	depthBits: 24, nearMin: 1.0, stepsApart: 4, coplanarM: 0.3,
	/** O7: the sightline is sampled every 2 m; the rider and the road 20 and 40 m ahead stay clear, 80 and 150 m ahead nearly. */
	everyM: 2, clearAhead: [20, 40], mostlyAhead: [80, 150], mostlyShare: 0.02,
	/** O7: anything taller than this within `nearRoad` of the road's envelope fades. */
	fadeOverM: 2.0, nearRoad: 12,
	/** O8: 30 fps, up to 80 km/h; nothing larger than `popPx` appears in a frame. */
	fps: 30, maxKmh: 80, popPx: 3, fadeS: 0.5, hysteresis: 1.1, crossfadeS: 0.3, streamAhead: 1.2,
	/** The frame a pop is measured on: 1080 px tall, the ride camera's 52°. */
	frameH: 1080, fovDeg: 52,
} as const;

/** The depth buffer's levels: a shift, so the lint that keeps this path exact has no `**` to read. */
const DEPTH_LEVELS = 1 << RENDER_GATES.depthBits;

/** The smallest depth step at `d` metres: d² 2⁻ᵇⁱᵗˢ / near. */
export const depthStep = (d: number, near: number): number =>
	(d * d) / (DEPTH_LEVELS * near);

/** The farthest a surface `gap` metres off another keeps `stepsApart` depth steps from it. */
export const separatedTo = (gap: number, near: number): number =>
	Math.sqrt((gap * DEPTH_LEVELS * near) / RENDER_GATES.stepsApart);

/** Where a gap of `gap` metres starts to z-fight outright (one depth step). */
export const fightsFrom = (gap: number, near: number): number =>
	Math.sqrt(gap * DEPTH_LEVELS * near);

/** The projected height, in pixels, of `heightM` metres at `distM`. */
export const pixels = (heightM: number, distM: number): number =>
	((heightM / distM) * (RENDER_GATES.frameH / 2)) /
	Math.tan((RENDER_GATES.fovDeg / 2 / 180) * Math.PI);

/** A standing object as a sightline sees it: a prism over its footprint. */
export type Prism = {
	id: string;
	footprint: readonly P2[];
	base: number;
	top: number;
	/** Drawn through the dither fade, so it never hides the rider. */
	fades: boolean;
};

export type Pt = readonly [x: number, y: number, z: number];

/** The prism a segment `a` to `b` passes through, if it does: clipped to the convex footprint in plan, then to the height band. */
function passes(a: Pt, b: Pt, p: Prism): boolean {
	let t0 = 0;
	let t1 = 1;
	const dx = b[0] - a[0];
	const dz = b[2] - a[2];
	const n = p.footprint.length;
	const sign = Math.sign(
		p.footprint.reduce(
			(s, q, i) =>
				s +
				q[0] * p.footprint[(i + 1) % n][1] -
				p.footprint[(i + 1) % n][0] * q[1],
			0,
		),
	);
	for (let i = 0; i < n; i++) {
		const [px, pz] = p.footprint[i];
		const [qx, qz] = p.footprint[(i + 1) % n];
		// The edge's inward normal, for either winding.
		const nx = -(qz - pz) * sign;
		const nz = (qx - px) * sign;
		const num = nx * (a[0] - px) + nz * (a[2] - pz);
		const den = nx * dx + nz * dz;
		if (den === 0) {
			if (num < 0) return false;
		} else if (den > 0) t0 = Math.max(t0, -num / den);
		else t1 = Math.min(t1, -num / den);
		if (t0 > t1) return false;
	}
	const dy = b[1] - a[1];
	const y0 = a[1] + dy * t0;
	const y1 = a[1] + dy * t1;
	return Math.max(y0, y1) >= p.base && Math.min(y0, y1) <= p.top;
}

/** Every prism the segment `a` to `b` passes through. */
export const hits = (a: Pt, b: Pt, prisms: readonly Prism[]): Prism[] =>
	prisms.filter((p) => passes(a, b, p));
