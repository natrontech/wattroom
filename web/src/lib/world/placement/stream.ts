import { referenceSpeed } from '$lib/road/pace';
import { inside, type P2 } from './geom';
import type { Violation } from './types';

/**
 * The placement stream's gates (#3221): what a rider meets along a road, in
 * order, judged as the rider meets it — O9 rhythm, O11 a hash, O13 what may
 * not stand there — as pure predicates over what a build placed, so the set
 * pieces (#3077) and the props assert them without depending on each other.
 * Every time is the reference rider's, riding either way.
 *
 * The numbers are #3221's (docs/SPEC.md proposals, defaults — tune in alpha).
 */
// prettier-ignore
export const RHYTHM = {
	/** O9: the same kind, variant and colourway no closer than this, in seconds at the faster direction's reference speed. */
	apart: { small: 45, medium: 240, landmark: 720 },
	/** At most `most` identical within `metres`, except a declared cluster of at least `variants` variants. */
	frame: { metres: 150, most: 2, variants: 3 },
	/** Something new within `within` metres of the road at least every `seconds`, whichever way the road is ridden. */
	news: { within: 80, seconds: 90 },
	/** Real marks: one per kind per this many metres per side, and before any generated one. */
	real: 150,
	/** O13: a row of slats, pillars or posts flickers at most `hz` at `kmh`. */
	flicker: { kmh: 80, hz: 3 },
} as const;

export type Size = keyof typeof RHYTHM.apart;

/** One thing a rider passes. */
export type Passing = {
	id: string;
	kind: string;
	variant?: string;
	colourway?: string;
	size: Size;
	/** Metres along the road, the side it stands on, and metres from the centreline. */
	along: number;
	side: -1 | 1;
	offset: number;
	/** Map data or the generator's. */
	source: 'osm' | 'generated';
	/** A declared cluster it belongs to. */
	cluster?: string;
	/** Where it stands, x and z: what a privacy zone is measured against. */
	at: P2;
	/** One of a row: a slat, a pillar, a post. */
	row?: boolean;
};

/** The road's height every `step` metres from its start. */
export type Profile = { step: number; heights: ArrayLike<number> };

const v = (
	p: Passing,
	rule: Violation['rule'],
	by: number,
	why: string,
): Violation => ({
	rule,
	id: p.id,
	kind: p.kind,
	by,
	why,
});

const identity = (p: Passing) =>
	`${p.kind}|${p.variant ?? ''}|${p.colourway ?? ''}`;

function byAlong(stream: readonly Passing[], key: (p: Passing) => string) {
	const groups = new Map<string, Passing[]>();
	for (const p of stream) {
		const k = key(p);
		groups.set(k, [...(groups.get(k) ?? []), p]);
	}
	for (const g of groups.values()) g.sort((a, b) => a.along - b.along);
	return groups;
}

/**
 * The reference rider's clock along the road: seconds from its start at any
 * metre riding forward, riding back, and at the faster of the two on each
 * stretch — a descent's pace, on a climb ridden either way.
 */
export function clock(profile: Profile) {
	const { step, heights } = profile;
	const n = heights.length;
	const forward = new Float64Array(n);
	const back = new Float64Array(n);
	const fast = new Float64Array(n);
	for (let i = 1; i < n; i++) {
		const g = ((heights[i] - heights[i - 1]) / step) * 100;
		const up = referenceSpeed(g);
		const down = referenceSpeed(-g);
		forward[i] = forward[i - 1] + step / up;
		back[i] = back[i - 1] + step / down;
		fast[i] = fast[i - 1] + step / Math.max(up, down);
	}
	const read = (a: Float64Array) => (along: number) => {
		const f = Math.min(Math.max(along / step, 0), n - 1);
		const i = Math.min(Math.floor(f), n - 2);
		return a[i] + (a[i + 1] - a[i]) * (f - i);
	};
	return {
		forward: read(forward),
		back: read(back),
		fast: read(fast),
		length: (n - 1) * step,
	};
}

/** O9: the same kind, variant and colourway kept apart by its size's interval, at the faster direction's pace. */
export function apart(
	stream: readonly Passing[],
	profile: Profile,
): Violation[] {
	const t = clock(profile);
	const out: Violation[] = [];
	for (const g of byAlong(stream, identity).values())
		for (let k = 1; k < g.length; k++) {
			const need = Math.max(
				RHYTHM.apart[g[k - 1].size],
				RHYTHM.apart[g[k].size],
			);
			const gap = Math.abs(t.fast(g[k].along) - t.fast(g[k - 1].along));
			if (gap < need)
				out.push(
					v(
						g[k],
						'O9',
						need - gap,
						`the same ${g[k].kind} again after ${gap.toFixed(0)} s, wants ${need}`,
					),
				);
		}
	return out;
}

/** O9: at most two identical in any 150 m, but for a declared cluster of three variants or more. */
export function crowded(stream: readonly Passing[]): Violation[] {
	const variants = new Map<string, Set<string>>();
	for (const p of stream)
		if (p.cluster)
			variants.set(
				p.cluster,
				(variants.get(p.cluster) ?? new Set()).add(p.variant ?? ''),
			);
	const counted = (p: Passing) =>
		!p.cluster || (variants.get(p.cluster)?.size ?? 0) < RHYTHM.frame.variants;
	const out: Violation[] = [];
	for (const g of byAlong(stream.filter(counted), identity).values())
		for (let k = RHYTHM.frame.most; k < g.length; k++) {
			const span = g[k].along - g[k - RHYTHM.frame.most].along;
			if (span < RHYTHM.frame.metres)
				out.push(
					v(
						g[k],
						'O9',
						RHYTHM.frame.metres - span,
						`${RHYTHM.frame.most + 1} identical ${g[k].kind} within ${span.toFixed(0)} m`,
					),
				);
		}
	return out;
}

/** O9: never longer than 90 s with nothing new within 80 m of the road, riding either way. */
export function lulls(
	stream: readonly Passing[],
	profile: Profile,
): Violation[] {
	const t = clock(profile);
	const marks = stream
		.filter((p) => p.offset <= RHYTHM.news.within)
		.map((p) => p.along)
		.sort((a, b) => a - b);
	const edges = [0, ...marks, t.length];
	const out: Violation[] = [];
	for (let k = 1; k < edges.length; k++) {
		const a = edges[k - 1];
		const b = edges[k];
		const gap = Math.max(t.forward(b) - t.forward(a), t.back(b) - t.back(a));
		if (gap > RHYTHM.news.seconds)
			out.push({
				rule: 'O9',
				id: `lull@${Math.round(a)}`,
				kind: 'lull',
				by: gap - RHYTHM.news.seconds,
				why: `${gap.toFixed(0)} s from ${a.toFixed(0)} m to ${b.toFixed(0)} m with nothing new within ${RHYTHM.news.within} m`,
			});
	}
	return out;
}

/** O9: a real mark per kind per 150 m per side, and no generated one of its kind beside it. */
export function realFirst(stream: readonly Passing[]): Violation[] {
	const out: Violation[] = [];
	for (const g of byAlong(stream, (p) => `${p.kind}|${p.side}`).values()) {
		const real = g.filter((p) => p.source === 'osm');
		for (let k = 1; k < real.length; k++)
			if (real[k].along - real[k - 1].along < RHYTHM.real)
				out.push(
					v(
						real[k],
						'O9',
						RHYTHM.real - (real[k].along - real[k - 1].along),
						`a second real ${real[k].kind} within ${RHYTHM.real} m`,
					),
				);
		for (const p of g)
			if (
				p.source === 'generated' &&
				real.some((r) => Math.abs(r.along - p.along) < RHYTHM.real)
			)
				out.push(v(p, 'O9', 0, `a generated ${p.kind} beside a real one`));
	}
	return out;
}

/** O11: what a build placed, as one hash — the same for the same place whatever order or route it came by. */
export function streamHash(stream: readonly Passing[]): string {
	const rows = stream
		.map(
			(p) =>
				`${identity(p)}|${Math.round(p.at[0] * 100)}|${Math.round(p.at[1] * 100)}`,
		)
		.sort();
	let h = 0x811c9dc5;
	for (const row of rows)
		for (let i = 0; i < row.length; i++)
			h = Math.imul(h ^ row.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
}

/** O13: nothing from the map, object or name, inside a privacy zone. */
export function zoned(
	stream: readonly Passing[],
	zones: readonly (readonly P2[])[],
): Violation[] {
	return stream
		.filter((p) => p.source === 'osm' && zones.some((z) => inside(p.at, z)))
		.map((p) => v(p, 'O13', 0, `a map ${p.kind} inside a privacy zone`));
}

/** O13: a row of slats, pillars or posts passes at most 3 a second at 80 km/h. */
export function flicker(stream: readonly Passing[]): Violation[] {
	const least = RHYTHM.flicker.kmh / 3.6 / RHYTHM.flicker.hz;
	const out: Violation[] = [];
	for (const g of byAlong(
		stream.filter((p) => p.row),
		(p) => `${p.kind}|${p.side}`,
	).values())
		for (let k = 1; k < g.length; k++) {
			const gap = g[k].along - g[k - 1].along;
			if (gap < least)
				out.push(
					v(
						g[k],
						'O13',
						least - gap,
						`${g[k].kind} every ${gap.toFixed(1)} m flickers above ${RHYTHM.flicker.hz} Hz at ${RHYTHM.flicker.kmh} km/h`,
					),
				);
		}
	return out;
}
