// A designed road's scene as the stage draws it (designed.ts): its standing
// water as flat sheets, and its bridges, the deck under the ribbon, a
// parapet either side and piers down to the ground. Pure data in, geometry
// out, coloured by vertex so one flat material draws it in any look.
import * as THREE from 'three';
import { at } from '#lib/road/along.ts';
import type { Route } from '#lib/road/route.ts';
import type { Water } from './designed';
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
/** The painted STOP: a cell's width across the lane and its length along it (stretched, as road lettering is), the gap between letters, and how far short of the stop line it ends. */
const STOP_PAINT = { cell: 0.11, long: 0.36, gap: 0.22, before: 0.7 };
/** The stop line: metres thick, and how far from the side road's end it lies, on the junction's apron. */
const STOP_LINE = { thick: 0.5, at: 0.5 };
/** The apron: asphalt from this far back up the side road to the met road's edge line, flaring by `flare` either side. */
const APRON = { back: 1.2, flare: 2.2, lift: 0.03 };
/** The stop sign: its post's height, the disc's radius, and where it stands, back from the mouth and out from the centre. */
const STOP_SIGN = { up: 2.3, r: 0.42, back: 3.5, out: FORMATION + 0.4 };

/**
 * A junction as it is painted (side-roads.ts): where a side road ends at a
 * road's edge, asphalt across that road's verge and shoulder to its edge
 * line, so the two are one surface with no kerb of gravel between; a stop
 * line across the side road's own lane, STOP painted before it, and a stop
 * sign on its right. The road met has the right of way.
 */
export function junctions(
	route: Route,
	mouths: readonly {
		x: number;
		z: number;
		tx: number;
		tz: number;
		h: number;
	}[],
	metFrom: number,
	lift: number,
	colors: { asphalt: string; line: string; sign: string; post: string },
): THREE.BufferGeometry {
	const pos: number[] = [];
	const col: number[] = [];
	const asphalt = new THREE.Color(colors.asphalt);
	const line = new THREE.Color(colors.line);
	const sign = new THREE.Color(colors.sign);
	const post = new THREE.Color(colors.post);
	const quad = (c: THREE.Vector3[], tint: THREE.Color) => {
		for (const p of [c[0], c[1], c[2], c[0], c[2], c[3]]) {
			pos.push(p.x, p.y, p.z);
			col.push(tint.r, tint.g, tint.b);
		}
	};
	for (const m of mouths) {
		// Along the side road into the junction, and to the right of that: the lane a rider comes in on.
		const [rx, rz] = [-m.tz, m.tx];
		const y = yOf(route, m.h) + lift;
		const at = (along: number, right: number, dy = 0) =>
			new THREE.Vector3(
				m.x + m.tx * along + rx * right,
				y + dy,
				m.z + m.tz * along + rz * right,
			);
		const half = ROAD_W / 2 + 0.9;
		quad(
			[
				at(-APRON.back, -half),
				at(-APRON.back, half),
				at(metFrom, half + APRON.flare),
				at(metFrom, -half - APRON.flare),
			],
			asphalt,
		);
		const paint = APRON.lift;
		quad(
			[
				at(STOP_LINE.at, 0.15, paint),
				at(STOP_LINE.at, ROAD_W / 2 - 0.1, paint),
				at(STOP_LINE.at + STOP_LINE.thick, ROAD_W / 2 - 0.1, paint),
				at(STOP_LINE.at + STOP_LINE.thick, 0.15, paint),
			],
			line,
		);
		// STOP, read by the rider coming in: its letters' feet towards them, left to right across their lane.
		const wide = 4 * 5 * STOP_PAINT.cell + 3 * STOP_PAINT.gap;
		const left = (ROAD_W / 2 - wide) / 2 + 0.1;
		const top = STOP_LINE.at - STOP_PAINT.before;
		STOP_LETTERS.forEach((rows, letter) =>
			rows.forEach((row, r) => {
				for (let c = 0; c < 5; c++) {
					if (row[c] !== '1') continue;
					let to = c;
					while (to + 1 < 5 && row[to + 1] === '1') to++;
					const u0 =
						left +
						letter * (5 * STOP_PAINT.cell + STOP_PAINT.gap) +
						c * STOP_PAINT.cell;
					const u1 = u0 + (to - c + 1) * STOP_PAINT.cell;
					const a0 = top - r * STOP_PAINT.long;
					quad(
						[
							at(a0 - STOP_PAINT.long, u0, paint),
							at(a0 - STOP_PAINT.long, u1, paint),
							at(a0, u1, paint),
							at(a0, u0, paint),
						],
						line,
					);
					c = to;
				}
			}),
		);
		// The sign: an eight-sided disc on a post, facing the rider coming in.
		const foot = at(-STOP_SIGN.back, STOP_SIGN.out, -0.6);
		const head = at(-STOP_SIGN.back, STOP_SIGN.out, STOP_SIGN.up);
		const w = 0.04;
		quad(
			[
				foot.clone().add(new THREE.Vector3(rx * -w, 0, rz * -w)),
				foot.clone().add(new THREE.Vector3(rx * w, 0, rz * w)),
				head.clone().add(new THREE.Vector3(rx * w, 0, rz * w)),
				head.clone().add(new THREE.Vector3(rx * -w, 0, rz * -w)),
			],
			post,
		);
		for (const [r, tint, off] of [
			[STOP_SIGN.r, line, 0],
			[STOP_SIGN.r * 0.84, sign, 0.02],
		] as const) {
			const centre = head
				.clone()
				.add(new THREE.Vector3(-m.tx * (0.03 + off), 0, -m.tz * (0.03 + off)));
			const rim = Array.from({ length: 8 }, (_, k) => {
				const a = ((k + 0.5) * Math.PI) / 4;
				return centre
					.clone()
					.add(
						new THREE.Vector3(
							rx * Math.cos(a) * r,
							Math.sin(a) * r,
							rz * Math.cos(a) * r,
						),
					);
			});
			for (let k = 0; k < 8; k++)
				for (const p of [centre, rim[k], rim[(k + 1) % 8]]) {
					pos.push(p.x, p.y, p.z);
					col.push(tint.r, tint.g, tint.b);
				}
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}
