// What is built along a designed road (designed.ts), as the stage draws it:
// its bridges, each by its span and height one of four kinds; its guard
// rails, and on the mountain's stretches the pass road's granite instead:
// parapets of single blocks, retaining walls where the road is cut into the
// slope, guard stones; its avalanche galleries; and its tunnels, a portal
// set in the hill at each end and a lit tube between. Pure data in,
// geometry out, coloured by vertex and flat shaded, cut into pieces along
// the road so each is culled on its own (stage.ts draws them as one batch).
import * as THREE from 'three';
import { at } from '#lib/road/along.ts';
import type { Route } from '#lib/road/route.ts';
import { LIT, SNOWED_BY } from './materials';
import { prng } from './rand';
import { surfaceOf, yOf } from './road-surface';
import {
	BORE_BOXES,
	GALLERY,
	GALLERY_BACK,
	PORTAL,
	PORTAL_M,
	TUBE,
} from './structure-sizes';
import { FORMATION, ROAD_W } from './terrain/road-profile';

/** The colours of what is built: granite and concrete, steel, a tunnel's dark and its lamps, the earth and the snow on a gallery's roof. */
export type WorksColors = {
	stone: string;
	concrete: string;
	steel: string;
	dark: string;
	lamp: string;
	band: string;
	earth: string;
	snow: string;
};

type V = THREE.Vector3;
type Ring = V[];

/** Triangles with a colour each, flat: what one piece of the road's works is drawn from. */
class Build {
	pos: number[] = [];
	col: number[] = [];
	tri(a: V, b: V, c: V, t: THREE.Color) {
		for (const p of [a, b, c]) {
			this.pos.push(p.x, p.y, p.z);
			this.col.push(t.r, t.g, t.b);
		}
	}
	quad(a: V, b: V, c: V, d: V, t: THREE.Color) {
		this.tri(a, b, c, t);
		this.tri(a, c, d, t);
	}
	/** The skin between two rings of corners, open between the last and the first unless `closed`. */
	skin(a: Ring, b: Ring, t: THREE.Color, closed = true) {
		const n = closed ? a.length : a.length - 1;
		for (let i = 0; i < n; i++) {
			const j = (i + 1) % a.length;
			this.quad(a[i], a[j], b[j], b[i], t);
		}
	}
	/** A convex ring's face. */
	cap(r: Ring, t: THREE.Color) {
		for (let i = 1; i < r.length - 1; i++) this.tri(r[0], r[i], r[i + 1], t);
	}
	get empty() {
		return this.pos.length === 0;
	}
	geometry(): THREE.BufferGeometry {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
		g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
		g.computeVertexNormals();
		g.computeBoundingBox();
		g.computeBoundingSphere();
		return g;
	}
}

/** Metres of road a piece of the works covers: each is culled on its own. */
const PIECE_M = 240;

/** The works cut into pieces along each road, by key: what the stage's batch draws. */
export class Pieces {
	private builds = new Map<string, Build>();
	at(road: string, d: number): Build {
		const key = `${road}:${Math.floor(d / PIECE_M)}`;
		let b = this.builds.get(key);
		if (!b) this.builds.set(key, (b = new Build()));
		return b;
	}
	/** Each piece's geometry, by key. */
	geometries(): Map<string, THREE.BufferGeometry> {
		const out = new Map<string, THREE.BufferGeometry>();
		for (const [k, b] of this.builds) if (!b.empty) out.set(k, b.geometry());
		return out;
	}
	/** Every triangle, the tests' count. */
	get triangles() {
		let n = 0;
		for (const b of this.builds.values()) n += b.pos.length / 9;
		return n;
	}
}

/** A road at metre `d`: its point, the way ahead and to its left, and a point `u` metres left of its centre line, `dy` over its drawn asphalt and `a` metres on. */
export type Frame = ReturnType<ReturnType<typeof framer>>;
export function framer(route: Route, lift?: number) {
	const surface = surfaceOf(route, lift);
	return (d: number) => {
		const p = at(route, d);
		const lx = Math.cos(p.heading);
		const lz = -Math.sin(p.heading);
		const tx = Math.sin(p.heading);
		const tz = Math.cos(p.heading);
		const y = surface(d, 0).y;
		// The asphalt's tilt across, a bend's bank: what is built on the deck sits on it.
		const tilt = surface(d, 1).y - y;
		return {
			d,
			x: p.x,
			z: p.z,
			ele: p.ele,
			y,
			lx,
			lz,
			tx,
			tz,
			pt: (u: number, dy: number, a = 0) =>
				new THREE.Vector3(
					p.x + lx * u + tx * a,
					y + tilt * u + dy,
					p.z + lz * u + tz * a,
				),
			/** A point `u` left and `a` on at the scene's height `h`, level. */
			at: (u: number, h: number, a = 0) =>
				new THREE.Vector3(p.x + lx * u + tx * a, h, p.z + lz * u + tz * a),
		};
	};
}

const tone = (c: string) => new THREE.Color(c);
/** A colour a little lighter or darker, `k` from −1 to 1. */
const shade = (c: THREE.Color, k: number) =>
	c.clone().multiplyScalar(1 + 0.09 * k);

/** A box section round (u, dy), `w` wide and `h` high: its corners at frame `f`, `a` metres on. */
const section = (
	f: Frame,
	u: number,
	dy: number,
	w: number,
	h: number,
	a = 0,
) => [
	f.pt(u - w / 2, dy, a),
	f.pt(u - w / 2, dy + h, a),
	f.pt(u + w / 2, dy + h, a),
	f.pt(u + w / 2, dy, a),
];

/** A box standing on frame `f`'s road, `along` by `across` at its top, `wider` more at its foot, from scene height `foot` to `top`: a pier, a post. Its four sides and its top. */
function column(
	b: Build,
	f: Frame,
	u: number,
	along: number,
	across: number,
	foot: number,
	top: number,
	t: THREE.Color,
	wider = 0,
) {
	const ring = (h: number, grow: number) =>
		[
			[1, 1],
			[1, -1],
			[-1, -1],
			[-1, 1],
		].map(([s, k]) =>
			f.at(u + (k * (across + grow)) / 2, h, (s * (along + grow)) / 2),
		);
	const up = ring(top, 0);
	b.skin(up, ring(foot, wider), t);
	b.cap(up, t);
}

// ── Bridges ─────────────────────────────────────────────────────────────

/** Which bridge a span is: a slab over a stream, a girder bridge, a box-girder viaduct, or an arched one high over a gorge. */
export type BridgeKind = 'slab' | 'beam' | 'box' | 'arch';
/** A slab spans this far at the most; a girder bridge stands this high at the most, or is this long at the most; a viaduct this high and more is arched. */
export const BRIDGE = { slab: 40, beam: { high: 25, long: 150 }, arch: 70 };

/** The bridge a span of `length` metres gets, standing `high` metres over the ground at its highest. */
export function bridgeKind(length: number, high: number): BridgeKind {
	if (length <= BRIDGE.slab) return 'slab';
	if (high < BRIDGE.beam.high || length <= BRIDGE.beam.long) return 'beam';
	return high >= BRIDGE.arch ? 'arch' : 'box';
}

/** Each kind: its deck's depth under the asphalt (to the girders' or the box's foot), and metres between its piers or arches. */
const KIND: Record<BridgeKind, { soffit: number; bay: number }> = {
	slab: { soffit: 0.9, bay: 0 },
	beam: { soffit: 2.1, bay: 30 },
	box: { soffit: 4.4, bay: 50 },
	arch: { soffit: 1.3, bay: 38 },
};
/** The deck: its edge past the formation, the walkway's inner edge (over the shoulder, so no verge shows on a bridge) and its height over the asphalt, and the slab's underside. */
const DECK = {
	edge: FORMATION + 0.35,
	kerb: ROAD_W / 2 + 0.75,
	up: 0.15,
	slab: 0.75,
};
/** A slim parapet: a concrete upstand at the deck's edge, a railing on it, and a guard rail in front of it on the walkway. */
const PARAPET = { thick: 0.28, up: 0.62, rail: 1.18 };
/** Metres between a bridge's cross-sections, a railing's posts, a guard rail's. */
const DECK_STEP_M = 6;
const RAILING_POST_M = 3;
/** How far into the ground a pier is drawn. */
const SUNK = 3;

/** The span's highest stand over the ground, metres. */
function highest(
	route: Route,
	from: number,
	to: number,
	groundAt: (x: number, z: number) => number,
) {
	let high = 0;
	for (let d = from; d <= to; d += 4) {
		const p = at(route, d);
		high = Math.max(high, p.ele - groundAt(p.x, p.z));
	}
	return high;
}

/**
 * A road's bridges (world.bridges): under each span its deck, a walkway
 * either side over the shoulder, slim parapets, and what carries it to the
 * ground, by its kind (bridgeKind): a slab on stone abutments with low
 * granite sides; girders on two-legged piers; a deep box girder on
 * slender tapering piers; stone arches on tall piers.
 */
export function bridges(
	out: Pieces,
	key: string,
	route: Route,
	lift: number | undefined,
	spans: readonly (readonly [number, number])[],
	groundAt: (x: number, z: number) => number,
	colors: WorksColors,
	/** A road not ridden, seen from afar: its sides plain walls, no railing, guard rail or single blocks. */
	plain = false,
	/** A gravel lane's: metres from its centre to its grass edge's. A farm bridge as wide as that, plain sided, a slab or (longer than a slab spans) on girders. */
	narrow?: number,
) {
	const frame = framer(route, lift);
	const stone = tone(colors.stone);
	const concrete = tone(colors.concrete);
	const steel = tone(colors.steel);
	const groundY = (x: number, z: number) => yOf(route, groundAt(x, z));
	for (const [from, to] of spans) {
		const kind =
			narrow === undefined
				? bridgeKind(to - from, highest(route, from, to, groundAt))
				: to - from <= BRIDGE.slab
					? 'slab'
					: 'beam';
		const k = KIND[kind];
		const masonry = kind === 'slab' || kind === 'arch';
		const body = masonry ? stone : concrete;
		const rand = prng(Math.round(from * 7 + to));
		const n = Math.max(1, Math.round((to - from) / DECK_STEP_M));
		const metre = (i: number) => from + ((to - from) * i) / n;
		const E = narrow === undefined ? DECK.edge : narrow + 0.35;
		const kerb = narrow === undefined ? DECK.kerb : narrow;
		/** Girders' and a crosshead's legs' offset: under the deck's edge on a narrow one. */
		const leg = Math.min(2.3, E - 0.6);
		/** The deck's rings at frame `f`: its slab, its walkways, its parapets' upstands, the girders or the box under it. */
		const rings = (f: Frame) => {
			const slab =
				kind === 'box' ? DECK.slab : kind === 'beam' ? 0.7 : k.soffit;
			const r: { ring: Ring; tint: THREE.Color }[] = [
				{
					ring: [
						f.pt(E, -0.3),
						f.pt(-E, -0.3),
						f.pt(-E, -slab),
						f.pt(E, -slab),
					],
					tint: body,
				},
			];
			for (const s of [1, -1]) {
				r.push({
					ring: [
						f.pt(s * kerb, -0.3),
						f.pt(s * kerb, DECK.up),
						f.pt(s * E, DECK.up),
						f.pt(s * E, -0.3),
					],
					tint: masonry ? shade(stone, 0.6) : shade(concrete, 0.5),
				});
				if (!masonry || plain || narrow !== undefined)
					r.push({
						ring: section(
							f,
							s * (E - PARAPET.thick / 2),
							DECK.up,
							PARAPET.thick,
							PARAPET.up - DECK.up,
						),
						tint: masonry ? stone : concrete,
					});
			}
			if (kind === 'beam')
				for (const s of [1, -1])
					r.push({
						ring: section(f, s * leg, -k.soffit, 0.55, k.soffit - 0.7),
						tint: shade(concrete, -0.7),
					});
			if (kind === 'box')
				r.push({
					ring: [
						f.pt(3.6, -DECK.slab),
						f.pt(-3.6, -DECK.slab),
						f.pt(-2.7, -k.soffit),
						f.pt(2.7, -k.soffit),
					],
					tint: shade(concrete, -0.4),
				});
			return r;
		};
		let prev = rings(frame(from));
		const b0 = out.at(key, from);
		for (const { ring, tint } of prev) b0.cap(ring, tint);
		for (let i = 1; i <= n; i++) {
			const f = frame(metre(i));
			const next = rings(f);
			const b = out.at(key, f.d);
			prev.forEach((p, j) => b.skin(p.ring, next[j].ring, p.tint));
			prev = next;
		}
		for (const { ring, tint } of prev) out.at(key, to).cap(ring, tint);

		// The sides: low granite on a stone bridge, a railing and a guard rail on a concrete one.
		for (const s of plain || narrow !== undefined ? [] : [1, -1]) {
			if (masonry)
				granite(
					out,
					key,
					frame,
					from,
					to,
					s * (E - 0.26),
					0.52,
					DECK.up,
					kind === 'slab' ? 0.55 : 0.68,
					stone,
					rand,
					0.06,
				);
			else railing(out, key, frame, from, to, s, steel);
			// A guard rail in front, on the walkway: every bridge but a slab's over a stream.
			if (kind !== 'slab')
				guardRail(
					out,
					key,
					frame,
					from,
					to,
					s * (DECK.kerb + 0.3),
					s,
					steel,
					DECK.up,
					false,
					false,
				);
		}

		// Its ends stand on the land: an abutment under each, down into the ground.
		for (const [d, way] of [
			[from, 1],
			[to, -1],
		] as const) {
			const f = frame(d + way * 1.2);
			const foot = Math.min(groundY(f.x, f.z), f.y - k.soffit) - 1.5;
			column(out.at(key, d), f, 0, 2.4, 2 * E + 1.2, foot, f.y - 0.3, body);
		}

		if (kind === 'slab') continue;
		// Piers, evenly between the abutments; an arched viaduct's carry its arches.
		const bays = Math.max(1, Math.round((to - from) / k.bay));
		const supports: number[] = [];
		for (let i = 0; i <= bays; i++)
			supports.push(from + ((to - from) * i) / bays);
		for (let i = 1; i < bays; i++) {
			const d = supports[i];
			const f = frame(d);
			const b = out.at(key, d);
			const top = f.y - k.soffit;
			const foot =
				Math.min(
					...[-3, 3].flatMap((u) =>
						[-1.5, 1.5].map((a) => {
							const p = f.pt(u, 0, a);
							return groundY(p.x, p.z);
						}),
					),
				) - SUNK;
			if (foot >= top) continue;
			if (kind === 'beam') {
				// A crosshead on two legs.
				column(
					b,
					f,
					0,
					1.5,
					Math.min(7.2, 2 * E + 0.5),
					top - 0.9,
					top,
					concrete,
				);
				for (const u of [-leg, leg])
					column(
						b,
						f,
						u,
						1.0,
						1.0,
						foot,
						top - 0.9,
						concrete,
						0.01 * (top - foot),
					);
			} else if (kind === 'box') {
				// One slender pier, tapering up to the box.
				column(b, f, 0, 2.2, 4.4, foot, top, concrete, 0.04 * (top - foot));
			} else {
				column(b, f, 0, 3.2, 7.2, foot, top, stone, 0.035 * (top - foot));
			}
		}
		if (kind === 'arch')
			for (let i = 0; i < bays; i++)
				arch(
					out,
					key,
					frame,
					supports[i],
					supports[i + 1],
					k.soffit,
					stone,
					i === 0,
					i === bays - 1,
				);
	}
}

/**
 * An arch between two supports of a viaduct, under its deck: its barrel
 * round from one pier to the next, the spandrels filled up to the deck,
 * its ring a shade lighter on either face.
 */
function arch(
	out: Pieces,
	key: string,
	frame: (d: number) => Frame,
	a: number,
	b: number,
	soffit: number,
	stone: THREE.Color,
	first: boolean,
	last: boolean,
) {
	// From pier face to pier face: half a pier's width in at either end, an abutment's at the bridge's ends.
	const from = a + (first ? 2.4 : 1.6);
	const to = b - (last ? 2.4 : 1.6);
	const r = (to - from) / 2;
	const mid = frame((from + to) / 2);
	const crown = mid.y - soffit;
	const spring = crown - r;
	const half = 3.4;
	const ring = shade(stone, 0.8);
	const fill = shade(stone, -0.35);
	const STEPS = 10;
	const build = out.at(key, (a + b) / 2);
	let last_: { i: V[]; e: V[]; top: V[] } | null = null;
	for (let k = 0; k <= STEPS; k++) {
		const th = Math.PI - (Math.PI * k) / STEPS;
		const s = r * Math.cos(th);
		const h = spring + r * Math.sin(th);
		const f = frame((from + to) / 2 + s);
		// The intrados across the barrel, the extrados 1.1 m out at the same angle, and the deck's underside over that.
		const g = frame((from + to) / 2 + (r + 1.1) * Math.cos(th));
		const i = [-half, half].map((u) => f.at(u, h));
		const e = [-half, half].map((u) =>
			g.at(u, Math.min(g.y - soffit, spring + (r + 1.1) * Math.sin(th))),
		);
		const top = [-half, half].map((u) => g.at(u, g.y - soffit + 0.05));
		if (last_) {
			build.quad(last_.i[0], last_.i[1], i[1], i[0], fill);
			for (const side of [0, 1]) {
				build.quad(last_.i[side], last_.e[side], e[side], i[side], ring);
				build.quad(last_.e[side], last_.top[side], top[side], e[side], stone);
			}
		}
		last_ = { i, e, top };
	}
}

/** A railing on a concrete upstand: posts every 3 m, a handrail on them and a bar half way down. */
function railing(
	out: Pieces,
	key: string,
	frame: (d: number) => Frame,
	from: number,
	to: number,
	side: number,
	steel: THREE.Color,
) {
	const u = side * (DECK.edge - PARAPET.thick / 2);
	const n = Math.max(1, Math.round((to - from) / RAILING_POST_M));
	const bar = shade(steel, -0.6);
	let prev: Frame | null = null;
	for (let i = 0; i <= n; i++) {
		const f = frame(from + ((to - from) * i) / n);
		const b = out.at(key, f.d);
		post(b, f, u, 0.07, PARAPET.up - 0.02, PARAPET.rail, steel);
		if (prev) {
			// The handrail's top and its outer face; the bar's outer face.
			const top = PARAPET.rail;
			const mid = (PARAPET.up + PARAPET.rail) / 2;
			const o = u + side * 0.05;
			b.quad(
				prev.pt(u - side * 0.05, top),
				f.pt(u - side * 0.05, top),
				f.pt(o, top),
				prev.pt(o, top),
				steel,
			);
			b.quad(
				prev.pt(o, top),
				f.pt(o, top),
				f.pt(o, top - 0.07),
				prev.pt(o, top - 0.07),
				steel,
			);
			b.quad(
				prev.pt(o, mid),
				f.pt(o, mid),
				f.pt(o, mid - 0.05),
				prev.pt(o, mid - 0.05),
				bar,
			);
		}
		prev = f;
	}
}

/** A square post at `u`, `w` across, from `foot` to `top` over the asphalt: its four sides. */
function post(
	b: Build,
	f: Frame,
	u: number,
	w: number,
	foot: number,
	top: number,
	t: THREE.Color,
) {
	const ring = (h: number) => [
		f.pt(u - w / 2, h, -w / 2),
		f.pt(u + w / 2, h, -w / 2),
		f.pt(u + w / 2, h, w / 2),
		f.pt(u - w / 2, h, w / 2),
	];
	b.skin(ring(foot), ring(top), t);
}

// ── Guard rails and the pass road's granite ─────────────────────────────

/** A guard rail: its band's height over the asphalt and how deep, its posts' spacing, and the length of the ramp its band runs down into the ground at an open end. */
const RAIL = { low: 0.45, high: 0.78, post: 4, ramp: 8 };

/**
 * A steel guard rail at `u` along [from, to], its face to the road: a
 * W-beam band on posts every 4 m, held off them on spacers. An open end
 * (`rampFrom`, `rampTo`) runs its band down into the ground over 8 m past
 * the run, as Swiss rails end, so nothing blunt faces the traffic.
 */
function guardRail(
	out: Pieces,
	key: string,
	frame: (d: number) => Frame,
	from: number,
	to: number,
	u: number,
	side: number,
	steel: THREE.Color,
	base = 0,
	rampFrom = true,
	rampTo = true,
) {
	const dark = shade(steel, -1.2);
	const face = shade(steel, 0.6);
	// The band's section, its face to the road at −: its W's ridge, and its back.
	const w = (f: Frame, sink: number) => {
		const lo = base + RAIL.low - sink;
		const hi = base + RAIL.high - sink;
		return [f.pt(u, hi), f.pt(u - side * 0.08, (hi + lo) / 2), f.pt(u, lo)];
	};
	const a = rampFrom ? from - RAIL.ramp : from;
	const b = rampTo ? to + RAIL.ramp : to;
	const n = Math.max(1, Math.round((b - a) / RAIL.post));
	let prev: Ring | null = null;
	for (let i = 0; i <= n; i++) {
		const d = a + ((b - a) * i) / n;
		const f = frame(d);
		// How far the band has sunk on a ramped end: to under the ground at its tip.
		const into =
			d < from ? (from - d) / RAIL.ramp : d > to ? (d - to) / RAIL.ramp : 0;
		const sink = into * (base + RAIL.high + 0.15);
		const band = w(f, sink);
		const bd = out.at(key, d);
		if (prev) {
			bd.quad(prev[0], prev[1], band[1], band[0], face);
			bd.quad(prev[1], prev[2], band[2], band[1], steel);
			bd.quad(prev[2], prev[0], band[0], band[2], dark);
		}
		prev = band;
		// The post, down into the verge behind the band.
		if (into === 0)
			post(
				bd,
				f,
				u + side * 0.12,
				0.11,
				base - 0.6,
				base + RAIL.high - 0.04,
				dark,
			);
	}
}

/**
 * Granite blocks along [from, to], each set at `u` (its middle), `thick`
 * across, its foot sunk and its top `up` over the asphalt with a little of
 * its own, `gap` metres apart at the least: the pass road's parapet of
 * single blocks (with gaps between, as on the Susten), or a bridge's
 * coursed side (gaps a mason's joint wide). Each block a shade of its own.
 */
function granite(
	out: Pieces,
	key: string,
	frame: (d: number) => Frame,
	from: number,
	to: number,
	u: number,
	thick: number,
	base: number,
	up: number,
	stone: THREE.Color,
	rand: () => number,
	gap: number,
) {
	const parapet = gap > 0.2;
	let d = from + (parapet ? rand() * 0.6 : 0);
	while (d < to - 0.4) {
		const len = Math.min(
			to - d,
			parapet ? 1.3 + rand() * 0.7 : 1.4 + rand() * 0.7,
		);
		const top = up + (parapet ? (rand() - 0.5) * 0.14 : 0);
		const tint = shade(stone, rand() * 2 - 1);
		const f0 = frame(d);
		const f1 = frame(d + len);
		// A block's top a little narrower and shorter than its foot: dressed stone, its arrises knocked off.
		const ring = (f: Frame, h: number, k: number, a: number) => [
			f.pt(u - (k * thick) / 2, h, a),
			f.pt(u + (k * thick) / 2, h, a),
		];
		const foot = [
			...ring(f0, base - 0.5, 1, 0),
			...ring(f1, base - 0.5, 1, 0).reverse(),
		];
		const head = [
			...ring(f0, base + top, 0.84, 0.07),
			...ring(f1, base + top, 0.84, -0.07).reverse(),
		];
		const b = out.at(key, d);
		b.skin(foot, head, tint);
		b.cap(head, shade(tint, 0.7));
		d += len + (parapet ? gap * (0.6 + rand() * 0.8) : gap);
	}
}

/** The pass road's granite: a parapet block's height over the asphalt and its thickness, the gap between blocks; a retaining wall's face past the formation, its height and its courses; a guard stone's spacing. */
const STONE = {
	parapet: { up: 0.55, thick: 0.5, gap: 0.55, at: FORMATION - 0.2 },
	wall: { at: FORMATION + 0.25, up: 1.5, thick: 0.7, course: 0.75, block: 1.8 },
	guard: { every: 9, at: FORMATION - 0.15 },
};
/** Metres between the samples the ground is read at along the road; where the ground 7 m past the formation lies 2 m under it for 24 m the road has a rail; under 1 m, guard stones; 11 m out 4 m over it, it is cut deep into the slope. */
const READ = {
	step: 4,
	out: 7,
	drop: 2,
	low: 1,
	runM: 24,
	cutOut: 11,
	cut: 3,
};
/** The pass road's granite starts this far under the scene's snowline: the mountain's stretches. Under it, and on a road with no snow, steel. */
export const STONE_UNDER_SNOW_M = 450;

/** What a road's stretch is given beside it, by how the land lies there and how high it is: what the tests read. */
export type Edge = 'rail' | 'parapet' | 'guard' | 'wall';

/**
 * Where a road is given what, on each side, in runs of metres: a rail on
 * the drop side of the valley's roads, the mountain's granite parapet
 * there instead; guard stones where the mountain road's edge falls a
 * little; a retaining wall where it is cut into the slope. Nothing on a
 * bridge, in a gallery or a tunnel (`skip`). `stoneFrom` is the height,
 * metres above sea, from which a road is the mountain's.
 */
export function edgesOf(
	route: Route,
	groundAt: (x: number, z: number) => number,
	skip: readonly (readonly [number, number])[],
	stoneFrom: number,
): { edge: Edge; side: number; from: number; to: number }[] {
	const out: { edge: Edge; side: number; from: number; to: number }[] = [];
	const count = Math.floor(route.length / READ.step);
	const skipped = (d: number) =>
		skip.some(([a, b]) => d >= a - 2 && d <= b + 2);
	for (const side of [1, -1]) {
		const kinds: (Edge | null)[] = [];
		for (let i = 0; i <= count; i++) {
			const d = i * READ.step;
			if (skipped(d)) {
				kinds.push(null);
				continue;
			}
			const p = at(route, d);
			const lx = Math.cos(p.heading);
			const lz = -Math.sin(p.heading);
			const over = (o: number) =>
				groundAt(
					p.x + lx * side * (FORMATION + o),
					p.z + lz * side * (FORMATION + o),
				) - p.ele;
			const high = p.ele >= stoneFrom;
			const fall = over(READ.out);
			if (fall < -READ.drop) kinds.push(high ? 'parapet' : 'rail');
			else if (high && fall < -READ.low) kinds.push('guard');
			else if (high && over(READ.cutOut) > READ.cut) kinds.push('wall');
			else kinds.push(null);
		}
		for (let i = 0; i <= count;) {
			const kind = kinds[i];
			let j = i;
			while (j + 1 <= count && kinds[j + 1] === kind) j++;
			if (kind && (j - i) * READ.step >= (kind === 'guard' ? 16 : READ.runM))
				out.push({ edge: kind, side, from: i * READ.step, to: j * READ.step });
			i = j + 1;
		}
	}
	return out;
}

/** What `edgesOf` gives a road, built. */
export function roadEdges(
	out: Pieces,
	key: string,
	route: Route,
	groundAt: (x: number, z: number) => number,
	skip: readonly (readonly [number, number])[],
	stoneFrom: number,
	colors: WorksColors,
) {
	const frame = framer(route);
	const steel = tone(colors.steel);
	const stone = tone(colors.stone);
	const runs = edgesOf(route, groundAt, skip, stoneFrom);
	// A rail that runs up to a bridge carries on onto its walkway, unramped.
	const nearSkip = (d: number) =>
		skip.some(([a, b]) => Math.abs(d - a) < 6 || Math.abs(d - b) < 6);
	for (const { edge, side, from, to } of runs) {
		const rand = prng(Math.round(from * 13 + side * 7 + 1));
		if (edge === 'rail')
			guardRail(
				out,
				key,
				frame,
				from,
				to,
				side * (FORMATION + 0.35),
				side,
				steel,
				0,
				!nearSkip(from),
				!nearSkip(to),
			);
		else if (edge === 'parapet')
			granite(
				out,
				key,
				frame,
				from,
				to,
				side * STONE.parapet.at,
				STONE.parapet.thick,
				0,
				STONE.parapet.up,
				stone,
				rand,
				STONE.parapet.gap,
			);
		else if (edge === 'guard')
			for (let d = from + rand() * 3; d <= to; d += STONE.guard.every) {
				const f = frame(d);
				const tint = shade(stone, rand() * 2 - 1);
				column(
					out.at(key, d),
					f,
					side * STONE.guard.at,
					0.38,
					0.38,
					f.y - 0.6,
					f.y + 0.48 + rand() * 0.12,
					tint,
					0.1,
				);
			}
		else retaining(out, key, frame, from, to, side, stone, rand);
	}
}

/**
 * A retaining wall of coursed granite where the road is cut into the
 * slope: its face just past the formation, two courses of blocks each a
 * face of its own shade, a coping along its top.
 */
function retaining(
	out: Pieces,
	key: string,
	frame: (d: number) => Frame,
	from: number,
	to: number,
	side: number,
	stone: THREE.Color,
	rand: () => number,
) {
	const { at: face, up, thick, course, block } = STONE.wall;
	const u0 = side * face;
	const u1 = side * (face + thick);
	const courses = Math.round(up / course);
	const step = block;
	const n = Math.max(1, Math.round((to - from) / step));
	const cap = shade(stone, 0.9);
	let prev: Frame | null = null;
	for (let i = 0; i <= n; i++) {
		const f = frame(from + ((to - from) * i) / n);
		if (prev) {
			const b = out.at(key, f.d);
			// The face, course by course, each block its own shade, every other one's joints half a block on.
			for (let c = 0; c < courses; c++) {
				const lo = c === 0 ? -0.8 : c * course;
				const hi = (c + 1) * course;
				const split = c % 2 === 1;
				const parts = split
					? [
							[0, 0.5],
							[0.5, 1],
						]
					: [[0, 1]];
				for (const [s0, s1] of parts) {
					const tint = shade(stone, rand() * 2 - 1);
					const p = (fa: Frame, fb: Frame, s: number, h: number) =>
						fa.pt(u0, h).lerp(fb.pt(u0, h), s);
					b.quad(
						p(prev, f, s0, lo),
						p(prev, f, s1, lo),
						p(prev, f, s1, hi),
						p(prev, f, s0, hi),
						tint,
					);
				}
			}
			// Its coping, a little proud of the face, and its back.
			b.quad(
				prev.pt(u0 - side * 0.06, up),
				f.pt(u0 - side * 0.06, up),
				f.pt(u1, up + 0.12),
				prev.pt(u1, up + 0.12),
				cap,
			);
			b.quad(
				prev.pt(u1, up + 0.12),
				f.pt(u1, up + 0.12),
				f.pt(u1, -0.6),
				prev.pt(u1, -0.6),
				shade(stone, -0.8),
			);
		}
		prev = f;
	}
	// Each end closed.
	for (const d of [from, to]) {
		const f = frame(d);
		out
			.at(key, d)
			.quad(
				f.pt(u0, -0.8),
				f.pt(u0, up),
				f.pt(u1, up + 0.12),
				f.pt(u1, -0.8),
				stone,
			);
	}
}

// ── Galleries ───────────────────────────────────────────────────────────

/** How far a gallery's ribs and beams run up into its slab: past what the slab's straight runs between frames stray from them. */
const INTO_SLAB = 0.4;

/**
 * A road's avalanche galleries: a heavy concrete roof sloping up into the
 * hill on its back wall, on the open side a row of square pillars joined
 * by a beam arched between each two, a rib under the roof at each pillar,
 * and the roof dressed in the hill's earth, or its snow above the snowline,
 * so an avalanche runs over it.
 */
export function galleries(
	out: Pieces,
	key: string,
	route: Route,
	groundAt: (x: number, z: number) => number,
	spans: readonly (readonly [number, number])[],
	snowline: number | undefined,
	colors: WorksColors,
) {
	const frame = framer(route);
	const concrete = tone(colors.concrete);
	const pillar = shade(concrete, 0.7);
	const under = shade(concrete, -0.9);
	const band = tone(colors.band);
	// Snow drawn as the trees' is (materials.ts SNOWED_BY): white, and half of it kept white in the shade.
	const dress = (ele: number) =>
		snowline !== undefined && ele >= snowline
			? tone(colors.snow).multiplyScalar(SNOWED_BY)
			: tone(colors.earth);
	const { clear, thick } = GALLERY;
	const E = FORMATION + GALLERY.out;
	const bay = GALLERY.pillars;
	for (const [from, to] of spans) {
		const mid = at(route, (from + to) / 2);
		const lx = Math.cos(mid.heading);
		const lz = -Math.sin(mid.heading);
		const over = (side: number) =>
			groundAt(mid.x + lx * side * 60, mid.z + lz * side * 60);
		// Its back wall against the mountain: the side the ground stands higher on.
		const back = over(1) >= over(-1) ? 1 : -1;
		const uOpen = -back * (E + 0.5);
		const uWall = back * E;
		const uBack = back * (E + 0.8);
		const uHill = back * (E + GALLERY_BACK);
		const rise = 0.13 * (E + GALLERY_BACK + E + 0.5);
		/** The roof's section: its underside over the road, its top rising into the hill, and down behind the wall. */
		const roof = (f: Frame) => [
			f.pt(uOpen, clear),
			f.pt(uOpen, clear + thick),
			f.pt(uHill, clear + thick + rise),
			f.pt(uHill, clear + rise - 0.6),
			f.pt(uBack, clear),
		];
		/** Earth or snow on its top, thicker towards the hill, and banked from its back down onto the hill, so the gallery lies in the slope and an avalanche runs over it. */
		const cover = (f: Frame) => {
			const top = clear + thick + rise + 0.9;
			const far = (u: number) => {
				const p = f.pt(u, 0);
				return yOf(route, groundAt(p.x, p.z)) - f.y;
			};
			// The bank falls 1:2.2 to the hill, no further out than GALLERY.ramp.
			const run = Math.min(
				GALLERY.ramp,
				Math.max(2, 2.2 * (top - far(uHill + back * 8))),
			);
			const foot = Math.min(top - 0.5, far(uHill + back * run) - 0.4);
			return [
				f.pt(uOpen + back * 0.4, clear + thick - 0.05),
				f.pt(uOpen + back * 0.6, clear + thick + 0.3),
				f.pt(uHill, top),
				f.pt(uHill + back * run, foot),
				f.pt(uHill, foot - 0.6),
			];
		};
		const wall = (f: Frame) => [
			f.pt(uWall, -1),
			f.pt(uWall, clear),
			f.pt(uBack, clear),
			f.pt(uBack, -1),
		];
		const n = Math.max(1, Math.round((to - from) / 4));
		let prev: Frame | null = null;
		for (let i = 0; i <= n; i++) {
			const d = from + ((to - from) * i) / n;
			const f = frame(d);
			const b = out.at(key, d);
			const tint = dress(f.ele);
			if (prev) {
				b.skin(roof(prev), roof(f), concrete);
				b.skin(cover(prev), cover(f), tint, false);
				b.skin(wall(prev), wall(f), concrete);
				// The band painted along the wall at hip height, and a kerb over each shoulder: no verge under a roof, and no snow.
				b.quad(
					prev.pt(uWall - back * 0.02, 0.9),
					f.pt(uWall - back * 0.02, 0.9),
					f.pt(uWall - back * 0.02, 1.3),
					prev.pt(uWall - back * 0.02, 1.3),
					band,
				);
				for (const s of [1, -1]) {
					const inner = s * (ROAD_W / 2 + 0.1);
					const outer = s === back ? uWall : s * (E + 0.5);
					b.quad(
						prev.pt(inner, 0.07),
						f.pt(inner, 0.07),
						f.pt(outer, 0.07),
						prev.pt(outer, 0.07),
						pillar,
					);
					b.quad(
						prev.pt(inner, -0.4),
						f.pt(inner, -0.4),
						f.pt(inner, 0.07),
						prev.pt(inner, 0.07),
						pillar,
					);
				}
			}
			prev = f;
		}
		// Its mouths: the roof's section and the wall's, faced.
		for (const d of [from, to]) {
			const f = frame(d);
			const b = out.at(key, d);
			b.cap(roof(f), concrete);
			b.cap(wall(f), concrete);
			// The earth's own section only, over the roof's and behind it: a fan over all of it lay on the roof's face, and hung down across the mouth.
			const [, p1, p2, p3, p4] = cover(f);
			const tint = dress(f.ele);
			b.cap(
				[
					// The roof's top there, rising 13 % into the hill.
					f.pt(uOpen + back * 0.4, clear + thick + 0.13 * 0.4),
					p1,
					p2,
					f.pt(uHill, clear + thick + rise),
				],
				tint,
			);
			b.cap([p2, p3, p4], tint);
		}
		// Pillars every 6 m on the open side, a rib under the roof at each, and the beam between them arched.
		const bays = Math.max(1, Math.round((to - from) / bay));
		const len = (to - from) / bays;
		const uPillar = -back * (E + 0.1);
		for (let k = 0; k <= bays; k++) {
			const d = from + k * len;
			const f = frame(d);
			const b = out.at(key, d);
			// Up to the roof's underside, banked as it is.
			column(
				b,
				f,
				uPillar,
				0.85,
				0.85,
				f.y - 1,
				f.pt(uPillar, clear).y,
				pillar,
			);
			// A rib runs well up into the slab and the wall: its top a hair over the underside, the slab drawn between other frames, came through it in stripes.
			const rib = (a: number) => [
				f.pt(uPillar, clear - 0.7, a),
				f.pt(uPillar, clear + INTO_SLAB, a),
				f.pt(uWall + back * 0.3, clear + INTO_SLAB, a),
				f.pt(uWall + back * 0.3, clear - 0.7, a),
			];
			// The end ribs kept inside the mouths, off the roof's end face.
			const a0 = k === 0 ? 0.1 : k === bays ? -0.7 : -0.3;
			b.skin(rib(a0), rib(a0 + 0.6), under);
			if (k === bays) continue;
			// The beam along the open edge, low at each pillar and high mid-bay: an arch each bay.
			const STEPS = 6;
			let last: Ring | null = null;
			for (let s = 0; s <= STEPS; s++) {
				const g = frame(d + (len * s) / STEPS);
				const low = clear - 1.35 + 0.95 * Math.sin((Math.PI * s) / STEPS);
				// Its face stops just under the roof's and its top runs up into the slab, a chamfer between: nothing of it lies on the roof's faces.
				const ring = [
					g.pt(uOpen, low),
					g.pt(uOpen, clear - 0.04),
					g.pt(uOpen + back * 0.25, clear + INTO_SLAB),
					g.pt(uPillar + back * 0.55, clear + INTO_SLAB),
					g.pt(uPillar + back * 0.55, low),
				];
				if (last) b.skin(last, ring, pillar);
				last = ring;
			}
		}
	}
}

// ── Tunnels ─────────────────────────────────────────────────────────────

/** Metres between a tube's sections, and between its lamps. */
const TUBE_STEP_M = 4;
const LAMP_M = 8;

/** The tube's walls are painted light to this height over the road. */
const PAINTED = 1.8;
/** The vault: the circle through both walls' heads and the crown, its centre's height over the road. */
const VAULT_Y =
	(TUBE.crown ** 2 - TUBE.wall ** 2 - TUBE.half ** 2) /
	(2 * (TUBE.crown - TUBE.wall));
/** The tube's inside across, (u, dy): from the floor under the right kerb, up the right wall, over the vault and down the left wall to the floor. */
const PROFILE: [number, number][] = (() => {
	const { half, wall, crown } = TUBE;
	const r = crown - VAULT_Y;
	const a0 = Math.atan2(wall - VAULT_Y, half);
	const pts: [number, number][] = [
		[-half, -0.7],
		[-half, PAINTED],
		[-half, wall],
	];
	const STEPS = 7;
	for (let k = 1; k < STEPS; k++) {
		const a = Math.PI - a0 - ((Math.PI - 2 * a0) * k) / STEPS;
		pts.push([r * Math.cos(a), VAULT_Y + r * Math.sin(a)]);
	}
	pts.push([half, wall], [half, PAINTED], [half, -0.7]);
	return pts;
})();
/** Whether a point of the profile is on a wall, not the vault. */
const onWall = ([u]: [number, number]) => Math.abs(u) > TUBE.half - 1e-6;
/** The profile `by` metres further out, all round: the walls straight out, the vault from its centre. */
const outward = (by: number): [number, number][] =>
	PROFILE.map(([u, y]) => {
		if (onWall([u, y])) return [u + Math.sign(u) * by, y < 0 ? y - by : y];
		const len = Math.hypot(u, y - VAULT_Y) || 1;
		return [u + (u / len) * by, y + ((y - VAULT_Y) / len) * by];
	});

/**
 * A road's tunnels (world.tunnels): the tube through the hill, dark, its
 * lower walls painted light, a lamp every 8 m either side of the crown and
 * a kerb over each shoulder; its concrete shell where it lies in the
 * portal's cutting; and at each end a concrete portal set into the hill,
 * a granite arch round its mouth and a granite coping on its head.
 */
export function tunnels(
	out: Pieces,
	key: string,
	route: Route,
	lift: number | undefined,
	spans: readonly (readonly [number, number])[],
	colors: WorksColors,
) {
	const frame = framer(route, lift);
	const dark = tone(colors.dark);
	const painted = shade(tone(colors.concrete), -0.3);
	// Lit: drawn its own colour whatever light falls on it (materials.ts LIT).
	const lamp = tone(colors.lamp).multiplyScalar(LIT);
	const concrete = tone(colors.concrete);
	const stone = tone(colors.stone);
	const shell = outward(TUBE.shell);
	const kerbIn = ROAD_W / 2 + 0.25;
	for (const [from, to] of spans) {
		const n = Math.max(1, Math.round((to - from) / TUBE_STEP_M));
		let prev: Frame | null = null;
		const ring = (f: Frame, p: [number, number][]) =>
			p.map(([u, y]) => f.pt(u, y));
		for (let i = 0; i <= n; i++) {
			const d = from + ((to - from) * i) / n;
			const f = frame(d);
			if (prev) {
				const b = out.at(key, d);
				const a = ring(prev, PROFILE);
				const c = ring(f, PROFILE);
				for (let k = 0; k < PROFILE.length; k++) {
					const j = (k + 1) % PROFILE.length;
					// The walls' feet light to a lorry's height, the rest dark.
					const low =
						onWall(PROFILE[k]) &&
						onWall(PROFILE[j]) &&
						Math.max(PROFILE[k][1], PROFILE[j][1]) <= PAINTED;
					b.quad(a[k], a[j], c[j], c[k], low ? painted : dark);
				}
				// The kerbs, and their faces down to under the shoulder, so no verge shows under them.
				for (const s of [1, -1]) {
					b.quad(
						prev.pt(s * kerbIn, 0.12),
						f.pt(s * kerbIn, 0.12),
						f.pt(s * TUBE.half, 0.12),
						prev.pt(s * TUBE.half, 0.12),
						painted,
					);
					b.quad(
						prev.pt(s * kerbIn, -0.4),
						f.pt(s * kerbIn, -0.4),
						f.pt(s * kerbIn, 0.12),
						prev.pt(s * kerbIn, 0.12),
						painted,
					);
				}
				// The shell outside, where the tube stands in the portal's cutting before the hill closes over it.
				if (
					d - from <= PORTAL_M + TUBE_STEP_M ||
					to - d <= PORTAL_M + TUBE_STEP_M
				)
					b.skin(ring(f, shell), ring(prev, shell), concrete, false);
			}
			prev = f;
		}
		// Lamps either side of the crown.
		for (let d = from + LAMP_M / 2; d < to; d += LAMP_M) {
			const f = frame(d);
			const b = out.at(key, d);
			for (const u of [-1.7, 1.7]) {
				const y = TUBE.crown - 0.25;
				const lampRing = [
					f.pt(u - 0.18, y - 0.12, -0.7),
					f.pt(u + 0.18, y - 0.12, -0.7),
					f.pt(u + 0.18, y - 0.12, 0.7),
					f.pt(u - 0.18, y - 0.12, 0.7),
				];
				b.cap(lampRing, lamp);
				b.skin(
					lampRing,
					lampRing.map((p) => p.clone().setY(p.y + 0.14)),
					lamp,
				);
			}
		}
		portal(out.at(key, from), frame(from), -1, stone, concrete);
		portal(out.at(key, to), frame(to), 1, stone, concrete);
	}
}

/**
 * A tunnel's portal at frame `f`, facing the way `way` (−1 back along the
 * road, +1 on): a concrete face with the tube's mouth through it, its
 * shoulders falling to the cutting's slope either side, a granite arch
 * round the mouth standing a hand proud, and a granite coping on its head.
 */
function portal(
	b: Build,
	f: Frame,
	way: number,
	stone: THREE.Color,
	concrete: THREE.Color,
) {
	const H = PORTAL.half;
	const up = PORTAL.up;
	const outline: [number, number][] = [
		[-H, -1.2],
		[H, -1.2],
		[H, 2.4],
		[TUBE.half + 2.8, up],
		[-TUBE.half - 2.8, up],
		[-H, 2.4],
	];
	const hole = PROFILE.map(
		([u, y]) => [u, Math.max(y, -1.2)] as [number, number],
	);
	const front = way * 1.2;
	const v2 = (p: [number, number][]) =>
		p.map(([u, y]) => new THREE.Vector2(u, y));
	const faces = THREE.ShapeUtils.triangulateShape(v2(outline), [v2(hole)]);
	const all = [...outline, ...hole];
	const at = (p: [number, number], a: number) => f.pt(p[0], p[1], a);
	for (const [i, j, k] of faces) {
		b.tri(at(all[i], front), at(all[j], front), at(all[k], front), concrete);
		b.tri(at(all[i], 0), at(all[k], 0), at(all[j], 0), shade(concrete, -0.6));
	}
	// Its edges round the outside and the mouth's reveal through it.
	b.skin(
		outline.map((p) => at(p, front)),
		outline.map((p) => at(p, 0)),
		shade(concrete, -0.3),
	);
	b.skin(
		hole.map((p) => at(p, 0)),
		hole.map((p) => at(p, front)),
		shade(concrete, -0.5),
		false,
	);
	// The arch round the mouth, a hand proud.
	const ring = outward(0.85).map(
		([u, y]) => [u, Math.max(y, -1.2)] as [number, number],
	);
	const proud = front + way * 0.15;
	const light = shade(stone, 0.5);
	for (let k = 1; k < hole.length - 1; k++) {
		const [p0, p1, q0, q1] = [hole[k - 1], hole[k], ring[k - 1], ring[k]];
		b.quad(at(p0, proud), at(p1, proud), at(q1, proud), at(q0, proud), light);
		b.quad(at(q0, proud), at(q1, proud), at(q1, front), at(q0, front), light);
	}
	b.quad(
		at(hole[hole.length - 2], proud),
		at(hole[hole.length - 1], proud),
		at(ring[ring.length - 1], proud),
		at(ring[ring.length - 2], proud),
		light,
	);
	// The coping along its head.
	const w = TUBE.half + 3.1;
	const cop = [
		f.pt(-w, up, front + way * 0.25),
		f.pt(w, up, front + way * 0.25),
		f.pt(w, up + 0.4, front + way * 0.25),
		f.pt(-w, up + 0.4, front + way * 0.25),
	];
	const back = cop.map((p) =>
		p.clone().addScaledVector(new THREE.Vector3(f.tx, 0, f.tz), -way * 1.8),
	);
	b.skin(cop, back, shade(stone, -0.3));
	b.cap(cop, shade(stone, -0.3));
}

/** Each portal's cut-out: from a hand before its face to past where the hill closes over the tube and its 10 m cells. */
const BORE_REACH_M = PORTAL_M + 18;

/** The terrain's cut-outs for a road's tunnels: per box its centre and the way along (x, z, tx, tz), and its half length, half width, height at its centre and rise a metre on. */
export function boreBoxes(
	route: Route,
	lift: number | undefined,
	spans: readonly (readonly [number, number])[],
): [number, number, number, number, number, number, number, number][] {
	const frame = framer(route, lift);
	const out: [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
	][] = [];
	const LEN = BORE_REACH_M / 3;
	for (const [from, to] of spans)
		for (const [start, way] of [
			[from, 1],
			[to, -1],
		] as const)
			for (let k = 0; k < 3; k++) {
				const a = start + way * (k * LEN - 0.6);
				const b = start + way * ((k + 1) * LEN);
				const f = frame((a + b) / 2);
				const g = frame(Math.max(a, b));
				const h = frame(Math.min(a, b));
				const len = Math.abs(b - a);
				out.push([
					f.x,
					f.z,
					f.tx,
					f.tz,
					len / 2 + 0.3,
					TUBE.half - 0.05,
					f.y,
					(g.y - h.y) / len,
				]);
			}
	return out;
}

export { BORE_BOXES };
