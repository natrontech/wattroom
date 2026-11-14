/**
 * The road's drawn surface, three-free: where the ribbon lies in the scene,
 * and how the roads' surfaces stack where two of them meet. geometry.ts
 * draws on it; world.ts reads it to seat a side road on the road it joins.
 *
 * The stack, from the bottom: the ground, SUBGRADE (0.45 m) under a road's
 * line (terrain/ground.ts); a road joining another at a junction, SEAT_SINK
 * under that road's carriageway where the two overlap, and on its own line
 * past it; the road it joins, at its own lift (ROAD_LIFT, a side road
 * SIDE_SINK under the road ridden); and what is painted on a road, over the
 * ribbon it lies on (scenery.ts). Every surface a junction is made of lies
 * at one of these heights, never at two that merely agree to a centimetre
 * somewhere: two surfaces that agree only roughly leave a step, and through
 * a step the eye sees under the ribbon, to the ground.
 */
import { at } from '#lib/road/along.ts';
import type { Route } from '#lib/road/route.ts';
import { smoothstep } from './rand';
import { sharedAt } from './shared-road';
import { banksOf } from './terrain/road-frame';
import { FORMATION, ribbonRows } from './terrain/road-profile';

export const EXAG = 1.2; // vertical exaggeration; the Alps read flat from a chase cam otherwise
/** The road ridden's ribbon over its line. */
export const ROAD_LIFT = 0.12;
/** A side road's ribbon lies this far under the road ridden's. */
export const SIDE_SINK = 0.01;
/** And a road where it runs into the road it meets, this far under that road's carriageway: drawn under its asphalt, and level with it. */
export const SEAT_SINK = 0.01;
/** Metres past the formation of the road it meets over which a side road eases from that road's carriageway back to its own surface. */
export const SEAT_EASE_M = 8;

/** A roundabout's arm a finger over the road ridden where that laps it. */
export const ARM_RISE = 0.02;
/** And its ring a finger over the arm: the ring's asphalt and its edge, dashed across the mouth, lie whole over the arm's flared start, which the ring's shoulder gives way to. */
export const RING_RISE = 0.03;
/** A road's ribbon over its line: the road ridden's, or one of the map's other roads'. */
export const liftOf = (route: Route, ridden: boolean) =>
	ridden
		? ROAD_LIFT
		: ROAD_LIFT -
			SIDE_SINK +
			(route.widen && !route.gravel ? ARM_RISE : 0) +
			(route.level && route.loop ? RING_RISE : 0);

export const yOf = (route: Route, ele: number) => (ele - route.minEle) * EXAG;

/**
 * A road's drawn surface, as road() draws its ribbon with `lift`: the
 * height at metre `d`, `u` metres left of its centre line, banked as the
 * ribbon is, and seated on the road it runs into at a junction (seatOf).
 * What is painted on a road is laid on this, never on a guess at it: a
 * metre along a grade or across a bank is centimetres of height.
 */
export function surfaceOf(route: Route, lift = ROAD_LIFT) {
	const own = carriageway(route, lift);
	const seat = seatOf(route);
	return (d: number, u: number) => {
		const p = own(d, u);
		const s = seat?.(d, p.x, p.z);
		if (s) p.y += (s.y - p.y) * s.w;
		return p;
	};
}

/** Each road's banks, read once: a side road's every mouth reads the road it meets. */
const banked = new WeakMap<Route, Float64Array | null>();

/** The carriageway's own plane across, its centre's height and its bank: surfaceOf before any seat. */
function carriageway(route: Route, lift: number) {
	const banks = banked.has(route) ? banked.get(route)! : banksAlong(route);
	banked.set(route, banks);
	return (d: number, u: number) => {
		const p = at(route, Math.min(Math.max(d, 0), route.length));
		const k = banks
			? Math.min(banks.length - 1, Math.max(0, Math.round(d / 2)))
			: 0;
		const bank = banks ? banks[k] * (1 - flatAt(route, d)) : 0;
		return {
			x: p.x + Math.cos(p.heading) * u,
			y: yOf(route, p.ele) + lift - u * Math.tan(bank),
			z: p.z - Math.sin(p.heading) * u,
		};
	};
}

/** How far a road's bank is taken out at metre `d` (Route.flat): 1 drawn level across. */
export const flatAt = (route: Route, d: number) =>
	route.flat
		? sharedAt(
				{ shared: route.flat, length: route.length, step: route.step },
				d,
			)
		: 0;

/** A road's bank at each of its ribbon's rows, as road() banks them; none on a level road. */
function banksAlong(route: Route): Float64Array | null {
	if (route.level) return null;
	const rows = ribbonRows(route, 2);
	const cx: number[] = [];
	const cz: number[] = [];
	for (let k = 0; k < rows.count; k++) {
		const p = rows.row(k);
		cx.push(p.x);
		cz.push(p.z);
	}
	return banksOf(cx, cz);
}

/**
 * A road's carriageway as a height over the plan, near its metre `near`:
 * the plane of its asphalt at (x, z), carried on across its shoulders, the
 * way a road joining it meets it. What a side road is seated on (seatOf).
 */
export function carriagewayAt(route: Route, lift: number, near: number) {
	let surface: ReturnType<typeof carriageway> | null = null;
	const reach = 60;
	const a = Math.max(0, Math.floor((near - reach) / route.step));
	const b = Math.min(
		route.x.length - 2,
		Math.ceil((near + reach) / route.step),
	);
	return (x: number, z: number) => {
		let best = Infinity;
		let d = near;
		for (let i = a; i <= b; i++) {
			const sx = route.x[i + 1] - route.x[i];
			const sz = route.z[i + 1] - route.z[i];
			const px = x - route.x[i];
			const pz = z - route.z[i];
			const t = Math.min(
				1,
				Math.max(0, (px * sx + pz * sz) / (sx * sx + sz * sz || 1)),
			);
			const off = Math.hypot(px - sx * t, pz - sz * t);
			if (off < best) {
				best = off;
				d = (i + t) * route.step;
			}
		}
		// Across, from the drawn line's own point and heading there: the chord's foot is a hair off it on a bend.
		const p = at(route, d);
		const u = (x - p.x) * Math.cos(p.heading) - (z - p.z) * Math.sin(p.heading);
		surface ??= carriageway(route, lift);
		return surface(d, u).y;
	};
}

/**
 * Where a road runs into another at a junction (Route.meets, an entry with
 * `onto`), the height its surface takes at (x, z) and how much: on the met
 * road's formation its carriageway's plane, SEAT_SINK under it, so the two
 * asphalts are one surface and their shoulders meet as one; easing back to
 * its own over SEAT_EASE_M past that formation. Null where it meets none.
 * A side road meets a road at that road's height at its centre (side-roads.ts),
 * but a road on a grade or banked into a bend is centimetres higher or lower
 * at its edges, and that step showed the ground through it.
 */
export function seatOf(route: Route) {
	const entries = (route.meets ?? []).filter((o) => o.onto);
	if (entries.length === 0) return null;
	return (
		d: number,
		x: number,
		z: number,
	): { y: number; w: number; up: [number, number, number] } | null => {
		const L = route.length;
		const dd = d < 0 || d > L ? ((d % L) + L) % L : d;
		let best = Infinity;
		let hit: (typeof entries)[number] | null = null;
		for (const o of entries) {
			if (dd < o.from || dd > o.to) continue;
			for (let i = 0; i + 1 < o.x.length; i++) {
				const sx = o.x[i + 1] - o.x[i];
				const sz = o.z[i + 1] - o.z[i];
				const px = x - o.x[i];
				const pz = z - o.z[i];
				const t = Math.min(
					1,
					Math.max(0, (px * sx + pz * sz) / (sx * sx + sz * sz || 1)),
				);
				const off = Math.hypot(px - sx * t, pz - sz * t);
				if (off < best) {
					best = off;
					hit = o;
				}
			}
		}
		if (!hit || best > FORMATION + SEAT_EASE_M) return null;
		const y = hit.onto!(x, z);
		// The plane's up, from its rise half a metre east and half a metre south.
		const ex = (hit.onto!(x + 0.5, z) - y) / 0.5;
		const ez = (hit.onto!(x, z + 0.5) - y) / 0.5;
		const n = Math.hypot(ex, 1, ez);
		return {
			y: y - SEAT_SINK,
			w: 1 - smoothstep(FORMATION, FORMATION + SEAT_EASE_M, best),
			up: [-ex / n, 1 / n, -ez / n],
		};
	};
}
