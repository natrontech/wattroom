import {
	centroid,
	cross,
	overlapArea,
	polygonPolygon,
	polygonPolyline,
	samples,
	type P2,
} from './geom';
import {
	GATES,
	type Ground,
	type Placement,
	type Road,
	type Rule,
	type Violation,
} from './types';

/** The five gates, one function each; check.ts runs them. */

const v = (p: Placement, rule: Rule, by: number, why: string): Violation => ({
	rule,
	id: p.id,
	kind: p.kind,
	by,
	why,
});

/** Clearance from a road's drawn edge; the inside of a bend adds its sag. */
function edgeClearance(
	poly: readonly P2[],
	road: Road,
): { gap: number; inBend: boolean } {
	const gap = polygonPolyline(poly, road.points) - road.halfWidth;
	const c = centroid(poly);
	let k = 0;
	let best = Infinity;
	for (const [i, p] of road.points.entries()) {
		const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
		if (d < best) [best, k] = [d, i];
	}
	const pt = road.points;
	const a = pt[Math.max(k - 5, 0)];
	const m = pt[k];
	const b = pt[Math.min(k + 5, pt.length - 1)];
	const turn = cross([m[0] - a[0], m[1] - a[1]], [b[0] - m[0], b[1] - m[1]]);
	const side = cross([b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]]);
	return { gap, inBend: turn * side > 0 };
}

export function o1(
	p: Placement,
	roads: readonly Road[],
	ground: Ground,
): Violation[] {
	const C = GATES.clear;
	const out: Violation[] = [];
	const gaps = roads.map((r) => ({ r, ...edgeClearance(p.footprint, r) }));
	if (p.cls === 'kit' || p.cls === 'building')
		for (const { r, gap, inBend } of gaps) {
			const need =
				p.cls === 'kit' ? C.kit : C.building + (inBend ? (r.sag ?? 0) : 0);
			if (gap < need)
				out.push(
					v(
						p,
						'O1',
						need - gap,
						`${gap.toFixed(2)} m from a road's edge, needs ${need.toFixed(2)}`,
					),
				);
		}
	if (p.cls === 'furniture' && gaps.length > 0) {
		const [lo, hi] = C.furniture;
		const own = gaps.reduce((a, b) => (b.gap < a.gap ? b : a));
		if (own.gap < lo || own.gap > hi)
			out.push(
				v(
					p,
					'O1',
					own.gap < lo ? lo - own.gap : own.gap - hi,
					`${own.gap.toFixed(2)} m from its road's edge, wants ${lo}–${hi}`,
				),
			);
		for (const g of gaps)
			if (g !== own && g.gap < lo)
				out.push(v(p, 'O1', lo - g.gap, `on another road's edge`));
	}
	if (p.cls === 'overhead') {
		const c = centroid(p.footprint);
		const under = (p.underside ?? p.base) - ground(c[0], c[1]);
		if (under < C.overhead)
			out.push(
				v(p, 'O1', C.overhead - under, `${under.toFixed(2)} m of headroom`),
			);
		for (const leg of p.supports ?? [])
			for (const r of roads) {
				const gap = polygonPolyline(leg, r.points) - r.halfWidth;
				if (gap < C.support)
					out.push(
						v(
							p,
							'O1',
							C.support - gap,
							`a support ${gap.toFixed(2)} m from the edge`,
						),
					);
			}
	}
	return out;
}

export function o2(p: Placement, ground: Ground): Violation[] {
	const allow = (p.plinth ?? 0) + GATES.float;
	const out: Violation[] = [];
	for (const [where, pts] of [
		['base', samples(p.footprint)],
		['foot', p.feet ?? []],
	] as const) {
		let worst = -Infinity;
		for (const [x, z] of pts) worst = Math.max(worst, p.base - ground(x, z));
		if (worst > allow)
			out.push(
				v(
					p,
					'O2',
					worst - allow,
					`a ${where} ${worst.toFixed(2)} m above the ground`,
				),
			);
	}
	return out;
}

export function o3(p: Placement, ground: Ground): Violation[] {
	if (p.sunk) return [];
	const B = GATES.bury;
	const allow =
		p.cls === 'building'
			? p.hillside
				? Infinity
				: B.building
			: Math.min(B.kitShare * p.height, B.kitMax);
	let worst = -Infinity;
	for (const [x, z] of samples(p.footprint))
		worst = Math.max(worst, ground(x, z) - p.base);
	return worst > allow
		? [
				v(
					p,
					'O3',
					worst - allow,
					`buried ${worst.toFixed(2)} m, may sink ${allow.toFixed(2)}`,
				),
			]
		: [];
}

const unit = (a: P2) => {
	const n = Math.hypot(a[0], a[1]) || 1;
	return [a[0] / n, a[1] / n] as const;
};

export function o4(p: Placement): Violation[] {
	const out: Violation[] = [];
	if (p.up) {
		const [x, y, z] = p.up;
		const cos = y / (Math.hypot(x, y, z) || 1);
		if (cos < GATES.upright)
			out.push(
				v(
					p,
					'O4',
					GATES.upright - cos,
					`leans: up · vertical ${cos.toFixed(4)}`,
				),
			);
	}
	if (p.facing && p.travel) {
		// A sign faces the riders coming towards it.
		const f = unit(p.facing);
		const t = unit(p.travel);
		const deg =
			(Math.acos(Math.min(Math.max(-(f[0] * t[0] + f[1] * t[1]), -1), 1)) *
				180) /
			Math.PI;
		if (deg > GATES.signDeg)
			out.push(
				v(
					p,
					'O4',
					deg - GATES.signDeg,
					`faces ${deg.toFixed(0)}° off its traffic`,
				),
			);
	}
	if (p.across && p.travel) {
		const a = unit(p.across);
		const t = unit(p.travel);
		const deg =
			90 -
			(Math.acos(Math.min(Math.abs(a[0] * t[0] + a[1] * t[1]), 1)) * 180) /
				Math.PI;
		if (deg > GATES.archDeg)
			out.push(
				v(
					p,
					'O4',
					deg - GATES.archDeg,
					`${deg.toFixed(1)}° off square to the road`,
				),
			);
	}
	return out;
}

const declared = (a: Placement, b: Placement) =>
	(a.mayOverlap?.includes(b.kind) ?? false) ||
	(b.mayOverlap?.includes(a.kind) ?? false);

/** O5 between two placements. */
export function o5(a: Placement, b: Placement): Violation[] {
	if (declared(a, b)) return [];
	if (a.kind === b.kind) {
		const d = polygonPolygon(a.footprint, b.footprint);
		if (d < GATES.sameKindM)
			return [
				v(
					a,
					'O5',
					GATES.sameKindM - d,
					`another ${b.kind} (${b.id}) ${d.toFixed(2)} m away`,
				),
			];
	}
	const shared = overlapArea(a.footprint, b.footprint);
	return shared > GATES.overlapM2
		? [
				v(
					a,
					'O5',
					shared - GATES.overlapM2,
					`overlaps ${b.kind} (${b.id}) by ${shared.toFixed(3)} m²`,
				),
			]
		: [];
}
