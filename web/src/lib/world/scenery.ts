// A designed road's scene as the stage draws it (designed.ts): its standing
// water as flat sheets, the stop markings and roundabouts' dressing. What
// is built along the road, its bridges, rails, galleries and tunnels, is
// structures.ts's. Pure data in, geometry out, coloured by vertex so one
// flat material draws it in any look.
import * as THREE from 'three';
import { box, cyl, merge, tint } from './model';
import { cow } from './props';
import type { PropColors } from './styles';
import type { Route } from '#lib/road/route.ts';
import { ringSignAt, type Water } from './designed';
import { yOf } from './geometry';
import { FORMATION, ROAD_W } from './terrain/road-profile';

/** Sheets of water, each at its level: the lake's bed and the river's lie under them. */
export function waterSheets(
	route: Route,
	waters: readonly Water[],
	color: string,
	/** White water: a stream's where it falls. */
	white: string,
): THREE.BufferGeometry {
	const tint = new THREE.Color(color);
	const foam = new THREE.Color(white);
	const pos: number[] = [];
	const col: number[] = [];
	for (const w of waters) {
		if (w.run) {
			// Running water: a strip down its course, each cross-section at its own level, white where it falls.
			const n = w.run.levels.length;
			const last = w.outline.length - 1;
			const corner = (i: number, right: boolean) => {
				const [x, z] = w.outline[right ? last - i : i];
				const t = w.run!.foam[i];
				pos.push(x, yOf(route, w.run!.levels[i]), z);
				col.push(
					tint.r + (foam.r - tint.r) * t,
					tint.g + (foam.g - tint.g) * t,
					tint.b + (foam.b - tint.b) * t,
				);
			};
			for (let i = 0; i < n - 1; i++)
				for (const [k, right] of [
					[i, false],
					[i, true],
					[i + 1, true],
					[i, false],
					[i + 1, true],
					[i + 1, false],
				] as const)
					corner(k, right);
			continue;
		}
		const ring = w.outline.map(([x, z]) => new THREE.Vector2(x, z));
		const y = yOf(route, w.level);
		for (const face of THREE.ShapeUtils.triangulateShape(ring, [])) {
			// Counter-clockwise from above, whichever way the outline runs: both faces are drawn (the material is double-sided).
			for (const i of face) {
				pos.push(ring[i].x, y, ring[i].y);
				col.push(tint.r, tint.g, tint.b);
			}
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	g.computeBoundingSphere();
	return g;
}

/** STOP, as it is painted on the road: five cells across and seven along, each letter. */
const STOP_LETTERS = [
	['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
	['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
	['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
	['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
];
/** The incoming lane, metres right of the side road's centre line: what is painted keeps inside its centre line and its edge line (at ROAD_W / 2 − 0.25), a hand clear of both. */
export const STOP_LANE = { from: 0.45, to: ROAD_W / 2 - 0.25 - 0.4 };
/** The painted STOP: the gap between letters, a cell's length along the lane (stretched, as road lettering is), and how far before the stop line it ends. Its cells' width is what the lane leaves. */
const STOP_PAINT = { gap: 0.12, long: 0.32, before: 0.9 };
/** The stop line: metres thick, and how far from the centre of the road met its near edge lies: at that road's carriageway edge, just past its edge line, along it however the side road comes in. */
export const STOP_LINE = { thick: 0.4, off: ROAD_W / 2 };
/** A side road stops where it comes in within 35° of square to the road it meets; shallower, it forks off it, and nobody stops at a fork. */
export const SQUARE_COS = Math.cos((35 * Math.PI) / 180);
/** The stop sign: its post's height, the disc's radius, where it stands right of the centre, and how far from the road met's centre at the least: by the stop line, past that road's formation and clear of its verge. */
const STOP_SIGN = {
	up: 2.3,
	r: 0.42,
	out: FORMATION + 0.4,
	clear: FORMATION + 0.8,
};
/** Metres back from a side road's end its stop markings are looked for, at the most. */
const MOUTH_REACH_M = 30;
/** Paint lies this far over the road it is painted on. */
const PAINT_LIFT = 0.015;

/**
 * What a side road that comes in square is given at its mouth
 * (side-roads.ts): a stop line across its incoming lane, STOP painted
 * before it, and a stop sign on its right. All of it is laid on the side
 * road's own drawn surface (`surface`, geometry.ts surfaceOf), inside its
 * lane. The junction's asphalt and the met road's dashed edge are the
 * roads' own paint (crossings.ts), not laid here.
 */
export function stops(
	sides: readonly {
		length: number;
		surface: (d: number, u: number) => { x: number; y: number; z: number };
		/** Its first end's mouth and its last's. */
		mouths: readonly ({
			tx: number;
			tz: number;
			sx: number;
			sz: number;
			/** Metres from (x, z) to the centre line of the road met. */
			off: (x: number, z: number) => number;
		} | null)[];
	}[],
	colors: { line: string; sign: string; post: string },
): THREE.BufferGeometry {
	const pos: number[] = [];
	const col: number[] = [];
	const line = new THREE.Color(colors.line);
	const sign = new THREE.Color(colors.sign);
	const post = new THREE.Color(colors.post);
	const tri = (
		a: THREE.Vector3,
		b: THREE.Vector3,
		c: THREE.Vector3,
		tint: THREE.Color,
	) => {
		for (const p of [a, b, c]) {
			pos.push(p.x, p.y, p.z);
			col.push(tint.r, tint.g, tint.b);
		}
	};
	const quad = (c: THREE.Vector3[], tint: THREE.Color) => {
		tri(c[0], c[1], c[2], tint);
		tri(c[0], c[2], c[3], tint);
	};
	for (const side of sides)
		side.mouths.forEach((m, end) => {
			if (!m) return;
			const square = m.sx * m.tx + m.sz * m.tz;
			if (square < SQUARE_COS) return;
			// A spot `back` metres before the side road's end and `right` metres right of its centre line, as a rider coming in sees it; a rider leaving its first end rides against its metres.
			const spot = (back: number, right: number, up = PAINT_LIFT) => {
				const p = side.surface(
					end === 0 ? back : side.length - back,
					end === 0 ? right : -right,
				);
				return new THREE.Vector3(p.x, p.y + up, p.z);
			};
			// The first metre back from its end at which the point `right` of its centre line lies `off` from the road met's centre line: a side road may come in askew or on a bend, and the road met may bend.
			const backTo = (off: number, right: number) => {
				const short = (back: number) => {
					const p = spot(back, right);
					return m.off(p.x, p.z) < off;
				};
				let a = 0;
				while (a < MOUTH_REACH_M && short(a + 0.5)) a += 0.5;
				if (!short(a)) return a;
				let b = a + 0.5;
				for (let k = 0; k < 12; k++) {
					const mid = (a + b) / 2;
					if (short(mid)) a = mid;
					else b = mid;
				}
				return b;
			};
			// A band across the lane between two edges, each a metre back by its place across, cut every half metre across so it lies on a banked road.
			const band = (
				b0: (r: number) => number,
				b1: (r: number) => number,
				r0: number,
				r1: number,
			) => {
				const n = Math.max(1, Math.ceil((r1 - r0) / 0.5));
				for (let k = 0; k < n; k++) {
					const a = r0 + ((r1 - r0) * k) / n;
					const b = r0 + ((r1 - r0) * (k + 1)) / n;
					quad(
						[spot(b0(a), a), spot(b0(b), b), spot(b1(b), b), spot(b1(a), a)],
						line,
					);
				}
			};
			// The stop line lies along the road met, its near edge on that road's carriageway edge, as a skewed junction is painted: across the lane, each end where the edge is.
			const [r0, r1] = [STOP_LANE.from - 0.3, STOP_LANE.to + 0.3];
			band(
				(r) => backTo(STOP_LINE.off, r),
				(r) => backTo(STOP_LINE.off + STOP_LINE.thick, r),
				r0,
				r1,
			);
			// STOP behind it, square to the lane, read by the rider coming in: its letters' heads towards the line, left to right across the lane.
			const lineBack = Math.max(
				...[r0, (r0 + r1) / 2, r1].map((r) =>
					backTo(STOP_LINE.off + STOP_LINE.thick, r),
				),
			);
			const wide = STOP_LANE.to - STOP_LANE.from;
			const cell = (wide - 3 * STOP_PAINT.gap) / 20;
			const head = lineBack + STOP_PAINT.before;
			STOP_LETTERS.forEach((rows, letter) =>
				rows.forEach((row, r) => {
					for (let c = 0; c < 5; c++) {
						if (row[c] !== '1') continue;
						let to = c;
						while (to + 1 < 5 && row[to + 1] === '1') to++;
						const c0 =
							STOP_LANE.from + letter * (5 * cell + STOP_PAINT.gap) + c * cell;
						band(
							() => head + r * STOP_PAINT.long,
							() => head + (r + 1) * STOP_PAINT.long,
							c0,
							c0 + (to - c + 1) * cell,
						);
						c = to;
					}
				}),
			);
			// The sign: an eight-sided disc on a post, facing the rider coming in, at the stop line where its corner leaves it room.
			const at = Math.max(lineBack, backTo(STOP_SIGN.clear, STOP_SIGN.out));
			const foot = spot(at, STOP_SIGN.out, -0.9);
			const top = spot(at, STOP_SIGN.out, STOP_SIGN.up);
			top.x = foot.x;
			top.z = foot.z;
			// Across the road, towards its centre, from the post: the disc's own width runs this way.
			const inner = spot(at, STOP_SIGN.out - 1);
			const ax = new THREE.Vector3(
				inner.x - foot.x,
				0,
				inner.z - foot.z,
			).normalize();
			// And towards the rider.
			const far = spot(at + 1, STOP_SIGN.out);
			const facing = new THREE.Vector3(
				far.x - foot.x,
				0,
				far.z - foot.z,
			).normalize();
			quad(
				[
					foot.clone().addScaledVector(ax, -0.04),
					foot.clone().addScaledVector(ax, 0.04),
					top.clone().addScaledVector(ax, 0.04),
					top.clone().addScaledVector(ax, -0.04),
				],
				post,
			);
			for (const [r, tint, off] of [
				[STOP_SIGN.r, line, 0.03],
				[STOP_SIGN.r * 0.84, sign, 0.05],
			] as const) {
				const centre = top.clone().addScaledVector(facing, off);
				const rim = Array.from({ length: 8 }, (_, k) => {
					const a = ((k + 0.5) * Math.PI) / 4;
					return centre
						.clone()
						.addScaledVector(ax, Math.cos(a) * r)
						.add(new THREE.Vector3(0, Math.sin(a) * r, 0));
				});
				for (let k = 0; k < 8; k++) tri(centre, rim[k], rim[(k + 1) % 8], tint);
			}
		});
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

/** A roundabout's signs: the give-way triangle's height on its post (designed.ts ringSignAt says where it stands). */
const RING_SIGN = { up: 2.2 };

/** A tube from `a` to `b`. */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number) {
	const dir = b.clone().sub(a);
	const g = cyl(r, r, dir.length(), 6);
	g.applyQuaternion(
		new THREE.Quaternion().setFromUnitVectors(
			new THREE.Vector3(0, 1, 0),
			dir.clone().normalize(),
		),
	);
	const mid = a.clone().add(b).multiplyScalar(0.5);
	return g.translate(mid.x, mid.y, mid.z);
}

/** A bicycle in bronze, four times life size, on a stone plinth: the village's. */
function bicycleStatue(c: PropColors) {
	const v = (x: number, y: number) => new THREE.Vector3(x, y + 1.4, 0);
	const [rear, front, seat, head, crank] = [
		v(-2, 1.5),
		v(2, 1.5),
		v(-0.9, 3.9),
		v(1.5, 3.9),
		v(-0.2, 1.5),
	];
	const wheel = (at: THREE.Vector3) =>
		new THREE.TorusGeometry(1.5, 0.13, 6, 22).translate(at.x, at.y, 0);
	return merge([
		tint(cyl(3.4, 3.8, 1.4, 12).translate(0, 0.7, 0), c.stone),
		...[
			wheel(rear),
			wheel(front),
			tube(rear, seat, 0.11),
			tube(rear, crank, 0.11),
			tube(crank, seat, 0.12),
			tube(crank, head, 0.12),
			tube(seat, head, 0.12),
			tube(head, front, 0.11),
			tube(seat, v(-1.0, 4.4), 0.1),
			tube(v(-1.45, 4.4), v(-0.55, 4.4), 0.14),
			tube(head, v(1.4, 4.6), 0.1),
			tube(v(1.4, 4.6), v(2.0, 4.5), 0.1),
		].map((g) => tint(g.toNonIndexed(), c.bell)),
	]);
}

/** A cow three times life size on a stone plinth: the head of the lake's. */
const cowStatue = (c: PropColors) =>
	merge([
		tint(cyl(3.4, 3.8, 1.4, 12).translate(0, 0.7, 0), c.stone),
		cow(c).scale(3, 3, 3).translate(0, 1.4, 0),
	]);

/**
 * The roundabout's signs, as they stand before one in Switzerland: on one
 * post a give-way triangle, white in red and point down, over the blue
 * disc with its three white arrows going round. Faces +z, its foot at the
 * origin.
 */
function ringSign(c: PropColors) {
	// Each face stands clear in front of the post, the paint on it clear in front of the face: a post 5 cm thick came through a face laid on its axis.
	const face = (g: THREE.BufferGeometry, y: number, z: number, color: string) =>
		tint(g.rotateX(Math.PI / 2).translate(0, y, 0.1 + z), color);
	const y = RING_SIGN.up;
	// Three arrows going round anticlockwise: each a bar along the circle with a head at its leading end.
	const arrows = [0, 1, 2].flatMap((k) => {
		const a = (k * 2 * Math.PI) / 3;
		const on = (g: THREE.BufferGeometry) =>
			tint(g.translate(0, 0.21, 0).rotateZ(a).translate(0, y, 0.16), c.wall);
		return [
			on(box(0.2, 0.06, 0.02).translate(0.03, 0, 0)),
			on(
				cyl(0.09, 0.09, 0.02, 3)
					.rotateX(Math.PI / 2)
					.rotateZ(Math.PI / 2)
					.translate(-0.11, 0, 0),
			),
		];
	});
	return merge([
		tint(
			cyl(0.05, 0.05, y + 1.4, 6).translate(0, (y + 1.4) / 2 - 0.4, 0),
			c.pole,
		),
		face(cyl(0.52, 0.52, 0.04, 3), y + 0.95, 0, c.warning),
		face(cyl(0.3, 0.3, 0.04, 3), y + 0.95, 0.03, c.wall),
		face(cyl(0.42, 0.42, 0.04, 18), y, 0, c.water),
		...arrows,
	]);
}

/**
 * What dresses a roundabout (designed.ts roundaboutsOf): the statue on its
 * island, and before each arm the signs a rider meets coming in.
 */
export function roundabouts(
	route: Route,
	rings: readonly {
		x: number;
		z: number;
		r: number;
		ele: number;
		arms: readonly (readonly [number, number])[];
		statue: 'bicycle' | 'cow';
	}[],
	c: PropColors,
): THREE.BufferGeometry {
	const parts: THREE.BufferGeometry[] = [];
	for (const ring of rings) {
		const y = yOf(route, ring.ele);
		parts.push(
			(ring.statue === 'bicycle' ? bicycleStatue(c) : cowStatue(c)).translate(
				ring.x,
				y,
				ring.z,
			),
		);
		for (const arm of ring.arms) {
			const at = ringSignAt(ring, arm);
			parts.push(
				ringSign(c)
					.rotateY(Math.atan2(arm[0], arm[1]))
					.translate(at.x, y, at.z),
			);
		}
	}
	const g = merge(parts);
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

/**
 * The Swiss give-way line across each roundabout's entry lane: a broken
 * line along the ring's edge, just off its asphalt, from the arm's centre
 * line to a hand inside its edge line, which the rider coming in stops at
 * to let the ring go by. Laid on the arm's own drawn surface (`surface`,
 * geometry.ts surfaceOf), as a stop line is on its side road's. The ring's
 * own edge line, dashed across the mouth, is its paint (crossings.ts).
 */
export function giveWays(
	rings: readonly { x: number; z: number; r: number }[],
	arms: readonly {
		route: Route;
		surface: (d: number, u: number) => { x: number; y: number; z: number };
	}[],
	color: string,
): THREE.BufferGeometry {
	const pos: number[] = [];
	for (const { route, surface } of arms) {
		const ring = rings.find(
			(k) => Math.abs(Math.hypot(route.x[0] - k.x, route.z[0] - k.z) - k.r) < 1,
		);
		if (!ring) continue;
		const wide = (m: number) => route.widen?.(m) ?? 1;
		// A spot `a` metres out from the ring's centre and `u` across the arm, left of its way out: the rider's right coming in.
		const spot = (a: number, u: number) => {
			const p = surface(a - ring.r, u);
			return [p.x, p.y + PAINT_LIFT, p.z];
		};
		const r0 = ring.r + ROAD_W / 2 + GIVE_WAY.off;
		const r1 = r0 + GIVE_WAY.thick;
		// The lane, at the ring's edge: from the centre line out to the edge line, a hand clear of each.
		const edge = (ROAD_W / 2 - 0.25 - 0.06) * wide(r0 - ring.r) - 0.15;
		// Arcs along the ring's edge, read by their angle off the arm's line.
		const from = Math.asin(GIVE_WAY.inside / r0);
		const to = Math.asin(Math.min(1, edge / r0));
		const period = (GIVE_WAY.dash + GIVE_WAY.gap) / r0;
		for (let a = from; a < to; a += period) {
			const b = Math.min(to, a + GIVE_WAY.dash / r0);
			const corner = (r: number, t: number) =>
				spot(r * Math.cos(t), r * Math.sin(t));
			const q = [corner(r0, a), corner(r0, b), corner(r1, b), corner(r1, a)];
			pos.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	const tone = new THREE.Color(color);
	g.setAttribute(
		'color',
		new THREE.Float32BufferAttribute(
			Array.from({ length: pos.length / 3 }, () => [
				tone.r,
				tone.g,
				tone.b,
			]).flat(),
			3,
		),
	);
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

/** The give-way line (Wartelinie): metres off the ring's asphalt it starts, thick, its dashes and gaps along the ring's edge, and how far from the arm's centre line it starts. */
export const GIVE_WAY = {
	off: 0.2,
	thick: 0.3,
	dash: 0.5,
	gap: 0.5,
	inside: 0.2,
};
