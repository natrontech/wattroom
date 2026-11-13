// A designed road's scene as the stage draws it (designed.ts): its standing
// water as flat sheets, and its bridges, the deck under the ribbon, a
// parapet either side and piers down to the ground. Pure data in, geometry
// out, coloured by vertex so one flat material draws it in any look.
import * as THREE from 'three';
import { box, cyl, merge, tint } from './model';
import { cow } from './props';
import type { PropColors } from './styles';
import { at } from '#lib/road/along.ts';
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

/** Metres between a bridge's cross-sections, and between its piers. */
const SECTION_M = 4;
const PIER_EVERY_M = 32;
/** The deck: how far under the road's surface its top and its soffit lie, and how far past the formation its edge. */
const DECK = { top: 0.5, soffit: 2.1, out: 0.5 };
/** The parapet: how high over the road, and how thick: from the deck's edge in to the shoulder's, so no verge shows on a bridge. */
const PARAPET = { up: 0.9, thick: DECK.out + FORMATION - (ROAD_W / 2 + 0.9) };
/** A pier: metres along the road and across it, and how far into the ground it is drawn. */
const PIER = { along: 2.2, across: 6.4, sunk: 3 };

/**
 * The road's bridges (world.bridges): under each span a deck slab the
 * ribbon lies on, a parapet along both edges, and a pier every 32 m down
 * to the ground or the bed of the water.
 */
export function bridges(
	route: Route,
	spans: readonly (readonly [number, number])[],
	groundAt: (x: number, z: number) => number,
	colors: { deck: string; pier: string },
): THREE.BufferGeometry {
	const pos: number[] = [];
	const col: number[] = [];
	const deck = new THREE.Color(colors.deck);
	const pier = new THREE.Color(colors.pier);
	const quad = (
		a: THREE.Vector3,
		b: THREE.Vector3,
		c: THREE.Vector3,
		d: THREE.Vector3,
		tint: THREE.Color,
	) => {
		for (const p of [a, b, c, a, c, d]) {
			pos.push(p.x, p.y, p.z);
			col.push(tint.r, tint.g, tint.b);
		}
	};
	/** A cross-section's corners at metre `d`: the deck's box and the two parapets', left to right. */
	const section = (d: number) => {
		const p = at(route, d);
		const lx = Math.cos(p.heading);
		const lz = -Math.sin(p.heading);
		const y = yOf(route, p.ele);
		const edge = FORMATION + DECK.out;
		const pt = (u: number, dy: number) =>
			new THREE.Vector3(p.x + lx * u, y + dy, p.z + lz * u);
		return {
			deck: [
				pt(edge, -DECK.top),
				pt(-edge, -DECK.top),
				pt(-edge, -DECK.soffit),
				pt(edge, -DECK.soffit),
			],
			walls: [edge, -edge].map((u) => {
				const inner = u - Math.sign(u) * PARAPET.thick;
				return [
					pt(u, -DECK.top),
					pt(u, PARAPET.up),
					pt(inner, PARAPET.up),
					pt(inner, -DECK.top),
				];
			}),
		};
	};
	/** The skin between two rings of corners, and a cap on each end where asked. */
	const skin = (a: THREE.Vector3[], b: THREE.Vector3[], tint: THREE.Color) => {
		for (let i = 0; i < a.length; i++) {
			const j = (i + 1) % a.length;
			quad(a[i], a[j], b[j], b[i], tint);
		}
	};
	const cap = (r: THREE.Vector3[], tint: THREE.Color) =>
		quad(r[0], r[1], r[2], r[3], tint);

	for (const [from, to] of spans) {
		const count = Math.max(1, Math.round((to - from) / SECTION_M));
		let prev = section(from);
		cap(prev.deck, deck);
		prev.walls.forEach((w) => cap(w, deck));
		for (let k = 1; k <= count; k++) {
			const next = section(from + ((to - from) * k) / count);
			skin(prev.deck, next.deck, deck);
			prev.walls.forEach((w, i) => skin(w, next.walls[i], deck));
			prev = next;
		}
		cap(prev.deck, deck);
		prev.walls.forEach((w) => cap(w, deck));
		// Piers, evenly between the abutments.
		const piers = Math.floor((to - from) / PIER_EVERY_M);
		for (let k = 1; k <= piers; k++) {
			const d = from + ((to - from) * k) / (piers + 1);
			const p = at(route, d);
			const tx = Math.sin(p.heading);
			const tz = Math.cos(p.heading);
			const lx = Math.cos(p.heading);
			const lz = -Math.sin(p.heading);
			const top = yOf(route, p.ele) - DECK.soffit;
			const foot = yOf(route, groundAt(p.x, p.z)) - PIER.sunk;
			if (foot >= top) continue;
			const ring = (y: number) =>
				[
					[1, 1],
					[1, -1],
					[-1, -1],
					[-1, 1],
				].map(
					([s, u]) =>
						new THREE.Vector3(
							p.x + (tx * s * PIER.along) / 2 + (lx * u * PIER.across) / 2,
							y,
							p.z + (tz * s * PIER.along) / 2 + (lz * u * PIER.across) / 2,
						),
				);
			skin(ring(top), ring(foot), pier);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

/** Metres between a rail's posts, and between the samples the ground is read at. */
const RAIL_STEP_M = 4;
/** A rail stands where the ground this far past the formation lies this far under the road, for at least this long a run. */
const RAIL = { out: 7, drop: 2.5, runM: 24, at: FORMATION + 0.35 };
/** A gallery: its roof's clear height and thickness, how far past the formation it reaches, and metres between its pillars. */
const GALLERY = { clear: 5, thick: 0.6, out: 0.9, pillars: 8 };

/**
 * What is built along a designed road (designed.ts): a guard rail on posts
 * wherever the land falls away beside it, a lake below or a hillside, seen
 * through; and its galleries, a roof against the mountain on a back wall,
 * open to the valley between pillars.
 */
export function roadworks(
	route: Route,
	groundAt: (x: number, z: number) => number,
	skip: readonly (readonly [number, number])[],
	galleries: readonly (readonly [number, number])[],
	colors: {
		rail: string;
		post: string;
		stone: string;
		/** A gallery's ribs and pillars, lighter than its wall, and the band painted along the wall. */
		light: string;
		band: string;
	},
): THREE.BufferGeometry {
	const pos: number[] = [];
	const col: number[] = [];
	const quad = (
		a: THREE.Vector3,
		b: THREE.Vector3,
		c: THREE.Vector3,
		d: THREE.Vector3,
		tint: THREE.Color,
	) => {
		for (const p of [a, b, c, a, c, d]) {
			pos.push(p.x, p.y, p.z);
			col.push(tint.r, tint.g, tint.b);
		}
	};
	const skin = (a: THREE.Vector3[], b: THREE.Vector3[], tint: THREE.Color) => {
		for (let i = 0; i < a.length; i++) {
			const j = (i + 1) % a.length;
			quad(a[i], a[j], b[j], b[i], tint);
		}
	};
	const rail = new THREE.Color(colors.rail);
	const post = new THREE.Color(colors.post);
	const stone = new THREE.Color(colors.stone);
	const light = new THREE.Color(colors.light);
	const band = new THREE.Color(colors.band);
	const frame = (d: number) => {
		const p = at(route, d);
		const lx = Math.cos(p.heading);
		const lz = -Math.sin(p.heading);
		const y = yOf(route, p.ele);
		return {
			pt: (u: number, dy: number) =>
				new THREE.Vector3(p.x + lx * u, y + dy, p.z + lz * u),
			/** How far the ground `out` metres past the formation on `side` lies over the road. */
			over: (side: number, out: number) =>
				groundAt(
					p.x + lx * side * (FORMATION + out),
					p.z + lz * side * (FORMATION + out),
				) - p.ele,
		};
	};
	type Frame = ReturnType<typeof frame>;
	/** A box section round (u, dy), `w` wide and `h` high. */
	const ring = (f: Frame, u: number, dy: number, w: number, h: number) => [
		f.pt(u - w / 2, dy),
		f.pt(u - w / 2, dy + h),
		f.pt(u + w / 2, dy + h),
		f.pt(u + w / 2, dy),
	];
	const count = Math.floor(route.length / RAIL_STEP_M);
	const within = (d: number, spans: readonly (readonly [number, number])[]) =>
		spans.some(([a, b]) => d >= a && d <= b);
	for (const side of [1, -1]) {
		// Where the land falls away on this side; a bridge has its parapets.
		const falls: boolean[] = [];
		for (let i = 0; i <= count; i++) {
			const d = i * RAIL_STEP_M;
			falls.push(
				!within(d, skip) && frame(d).over(side, RAIL.out) < -RAIL.drop,
			);
		}
		for (let i = 0; i <= count;) {
			if (!falls[i]) {
				i++;
				continue;
			}
			let j = i;
			while (j + 1 <= count && falls[j + 1]) j++;
			if ((j - i) * RAIL_STEP_M >= RAIL.runM) {
				let prev: THREE.Vector3[] | null = null;
				for (let k = i; k <= j; k++) {
					const f = frame(k * RAIL_STEP_M);
					const u = side * RAIL.at;
					// The post, down into the verge, and the rail from the last one.
					quad(
						f.pt(u - 0.07, -0.6),
						f.pt(u + 0.07, -0.6),
						f.pt(u + 0.07, 0.72),
						f.pt(u - 0.07, 0.72),
						post,
					);
					const band = ring(f, u, 0.42, 0.08, 0.3);
					if (prev) skin(prev, band, rail);
					prev = band;
				}
			}
			i = j + 1;
		}
	}
	for (const [from, to] of galleries) {
		const n = Math.max(1, Math.round((to - from) / RAIL_STEP_M));
		const mid = frame((from + to) / 2);
		// Its back wall stands against the mountain: the side the ground stands higher on.
		const back = mid.over(1, 60) >= mid.over(-1, 60) ? 1 : -1;
		const edge = FORMATION + GALLERY.out;
		const top = GALLERY.clear + GALLERY.thick;
		let roof: THREE.Vector3[] | null = null;
		let wall: THREE.Vector3[] | null = null;
		let last: { stripe: THREE.Vector3[]; kerbs: THREE.Vector3[][] } | null =
			null;
		for (let k = 0; k <= n; k++) {
			const d = from + ((to - from) * k) / n;
			const f = frame(d);
			const slab = [
				f.pt(edge, GALLERY.clear),
				f.pt(edge, top),
				f.pt(-edge, top),
				f.pt(-edge, GALLERY.clear),
			];
			const rear = ring(f, back * edge, -1, 0.6, GALLERY.clear + 1);
			// The wall's face, a hand inside it: a painted band at hip height. And a kerb over each shoulder, wall to edge line: no verge under a roof, and no snow.
			const face = back * (edge - 0.32);
			const stripe = [f.pt(face, 0.9), f.pt(face, 1.35)];
			const kerbs = [1, -1].map((side) => [
				f.pt(side * (ROAD_W / 2 + 0.1), 0.07),
				f.pt(side * edge, 0.07),
			]);
			if (roof && wall && last) {
				skin(roof, slab, stone);
				skin(wall, rear, stone);
				quad(last.stripe[0], last.stripe[1], stripe[1], stripe[0], band);
				kerbs.forEach((k, i) =>
					quad(last!.kerbs[i][0], last!.kerbs[i][1], k[1], k[0], light),
				);
			}
			last = { stripe, kerbs };
			// A rib under the roof at every pillar, and a deeper one at each mouth.
			const mouth = k === 0 || k === n;
			if (mouth || k % Math.round(GALLERY.pillars / RAIL_STEP_M) === 0) {
				const deep = mouth ? 0.7 : 0.4;
				const rib = (g: Frame) => [
					g.pt(edge + 0.05, GALLERY.clear - deep),
					g.pt(edge + 0.05, GALLERY.clear + 0.02),
					g.pt(-edge - 0.05, GALLERY.clear + 0.02),
					g.pt(-edge - 0.05, GALLERY.clear - deep),
				];
				const [a, b] = [rib(frame(d - 0.3)), rib(frame(d + 0.3))];
				skin(a, b, light);
				quad(a[0], a[1], a[2], a[3], light);
				quad(b[3], b[2], b[1], b[0], light);
			}
			if (k === 0 || k === n) quad(slab[0], slab[1], slab[2], slab[3], stone);
			roof = slab;
			wall = rear;
			// A pillar on the open side, every other section.
			if (k % Math.round(GALLERY.pillars / RAIL_STEP_M) === 0)
				skin(
					ring(f, -back * edge, -1, 0.9, GALLERY.clear + 1),
					ring(frame(d + 0.9), -back * edge, -1, 0.9, GALLERY.clear + 1),
					light,
				);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	g.computeVertexNormals();
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
