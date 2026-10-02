// Set pieces by place (#3077, ADR-0081): each stroke walked from its
// canonical start, every decision keyed by the stroke, its slot and the
// decision's number, so a descender meets the objects a climber met, only
// sooner. The rhythm is per metre at the uphill reference pace — something
// small every 20–40 s, something medium every 3–5 min, a chapel 15 min apart
// — and a piece is skipped where #3221's O9 would find its kind too near the
// last one stood on the stroke, measured at the faster direction's pace.
// Signs stand for their own traffic: a climb board at the foot for whoever
// climbs it, hairpins numbered from the top, a pass's sign each way.
// The plan reads the stroke alone, so it is whole and cheap. Whether and
// where a piece stands asks the ground, so each is decided only when a tile
// near it is settled (#3699): from the pieces of its kind planned before it,
// decided the same way, so the answer is the one a walk from the stroke's
// start would give, whichever tile asked first. Each stands through #3219's
// gates.
import { Biome } from './biome';
import { keyer, unit, type Salt } from './place/keyed';
import { namesFor, type Names } from './names';
import type { Class } from './placement/types';
import { RHYTHM, type Passing, type Size } from './placement/stream';
import type { KitKind } from './props/kit';
import type { Placer } from './props/placer';
import { rhythmOf } from './props/rhythm';
import { deg, hashOf, turnBy, type Turn } from './props/roads';
import type { Village } from './props/scatter';
import { RANK, tileKey, tileOf, type Candidate } from './props/tiles';
import { prng } from './rand';
import type { Ground, Origin } from './terrain/ground';
import { strokeRoad } from './terrain/road-profile';
import { climbsOf, hairpinsOf } from '$lib/road/climbs';
import { turnedRound } from '$lib/road/road';

export type PieceKind =
	| 'bench'
	| 'woodpile'
	| 'bales'
	| 'wayside'
	| 'signpost'
	| 'fountain'
	| 'fence'
	| 'flag'
	| 'linden'
	| 'chapel'
	| 'snowpole'
	| 'delineator'
	| 'house'
	| 'barn'
	| 'hut'
	| 'cow';
// `flag` indexes the style's flag colours: the world says where, the style says what.
export type Piece = {
	kind: PieceKind;
	x: number;
	y: number;
	z: number;
	turn: Turn;
	flag?: number;
};
export type SignLook = 'pass' | 'climb' | 'hairpin' | 'village';
export type Sign = {
	x: number;
	y: number;
	z: number;
	turn: Turn;
	lines: string[];
	look: SignLook;
	w: number;
	h: number;
};
export type Arch = {
	x: number;
	y: number;
	z: number;
	turn: Turn;
	label: string;
};
/** A piece as a tile stands it: the stroke it belongs to, and what O9 counts of it. */
export type Standing = { piece: Piece; line: number; pass?: Passing };

export const FLAGS = 4; // flagpoles at the summit, one colour each from the style

type Ctx = {
	salt: Salt;
	origin?: Origin;
	ground: Ground;
	/** The drawn ground and what grows on it; null where none is drawn. */
	heightAt: (x: number, z: number) => number;
	biomeAt: (x: number, z: number) => Biome | null;
	placer: Placer;
	villages: readonly Village[];
};

// The rhythm per stroke (docs/SPEC.md proposals): the midpoint and half-spread of each interval, uphill seconds.
const SMALL = { every: 30, spread: 10 };
const MEDIUM = { every: 240, spread: 60 };
const CHAPEL = 900;
const SMALL_KINDS = [
	'bench',
	'woodpile',
	'bales',
	'wayside',
	'signpost',
	'fence',
] as const;
const MEDIUM_KINDS = ['farmstead', 'fountain'] as const;
/** What O9 spaces each kind by; the rest are small. */
const SIZE: Partial<Record<PieceKind | 'herd', Size>> = {
	house: 'medium',
	barn: 'medium',
	fountain: 'medium',
	hut: 'medium',
	herd: 'medium',
	chapel: 'landmark',
};
const TILE_M = 5000;
/** Where a piece is tried along the road from where it was planned, nearest first. */
const SHIFTS = [0, 15, -15, 30, -30, 45, -45, 60, -60];
/** Road furniture is planned in stretches this long, each worked out as one. */
const STRETCH_M = 200;

/** Where a kind may stand. */
const fits: Record<(typeof SMALL_KINDS)[number], (b: Biome | null) => boolean> =
	{
		bench: () => true,
		woodpile: (b) => b === Biome.Forest || b === Biome.Meadow,
		bales: (b) => b === Biome.Meadow,
		wayside: () => true,
		signpost: () => true,
		fence: (b) => b === Biome.Meadow,
	};

/**
 * A piece O9 counts, in the order the stroke's plan meets it: where it was
 * planned, how far from there it may end up, and — once decided — the metre
 * it stood at, or null.
 */
type Item = {
	id: string;
	seq: number;
	s: number;
	reach: number;
	decide: () => void;
	at?: number | null;
};

/**
 * A group of pieces decided in order, each from the ones before it: a
 * farmstead's barn stands beside its house. Filed under the tile it was
 * planned in and worked out when a tile near it is settled.
 */
function group() {
	const steps: (() => void)[] = [];
	const out: Candidate<Standing>[] = [];
	let next = 0;
	return {
		out,
		/** Adds a step; what runs the group up to it. */
		step(fn: () => void): () => void {
			const k = steps.length;
			steps.push(fn);
			return () => {
				while (next <= k) steps[next++]();
			};
		},
		/** Every step run: the group's candidates. */
		all(): Candidate<Standing>[] {
			while (next < steps.length) steps[next++]();
			return out;
		},
	};
}

export function setPieces(c: Ctx) {
	const { salt, ground, heightAt, biomeAt, placer } = c;
	const origin = c.origin ?? [0, 0];
	const [e0, n0] = origin;
	const key = keyer(salt, 'setpiece');
	const tileNames = (x: number, z: number) =>
		namesFor(
			prng(
				keyer(salt, 'name')(
					Math.floor((e0 + x) / TILE_M),
					Math.floor((n0 - z) / TILE_M),
					1,
				),
			),
		);
	let names: Names | null = null;
	/** Each group of pieces, by the tile it was planned in. */
	const groups = new Map<string, ReturnType<typeof group>[]>();
	const signs: { sign: Omit<Sign, 'y'>; line: number; pass: Passing }[] = [];
	const arches: Omit<Arch, 'y'>[] = [];

	ground.lines.forEach((line, k) => {
		const stroke = hashOf(line.key);
		const r = rhythmOf(line);
		const w = r.walk;
		const u = (slot: number, d: number) => unit(key(stroke, slot, d));
		/** The n-th piece of a slot's group, as a slot of its own. */
		const sub = (slot: number, n: number) => slot * 16 + n;
		/** Faces the road from `side`, turned a little by `jitter` degrees. */
		const facing = (s: number, side: number, jitter = 0): Turn =>
			turnBy(turnBy(w.at(s).along, deg(side > 0 ? -90 : 90)), deg(jitter));

		/** A new group, filed under the tile metre `s` lies in. */
		function filed(s: number) {
			const g = group();
			const p = w.at(s);
			const id = tileKey(...tileOf(p.x, p.z, origin));
			groups.set(id, [...(groups.get(id) ?? []), g]);
			return g;
		}

		// O9's plan: every counted piece in the order the plan meets it, by kind and colourway.
		const counted = new Map<string, Item[]>();
		let seq = 0;
		/** Counts a piece of `kind` planned at `s`, ending up within `reach` metres of it, decided by `decide`. */
		function item(
			g: ReturnType<typeof group>,
			kind: PieceKind | 'herd',
			s: number,
			reach: number,
			decide: (self: Item) => number | null,
			colourway?: string,
		): Item {
			const id = `${kind}|${colourway ?? ''}`;
			const self: Item = { id, seq: seq++, s, reach, decide: () => {} };
			self.decide = g.step(() => {
				self.at = decide(self);
			});
			counted.set(id, [...(counted.get(id) ?? []), self]);
			return self;
		}
		/** Whether O9 finds a piece too near one of its kind that stood before it in the plan, standing at metre `at`. */
		function tooSoon(self: Item, at: number): boolean {
			const kind = self.id.split('|')[0] as PieceKind | 'herd';
			const need = RHYTHM.apart[SIZE[kind] ?? 'small'];
			const t = r.fast(at);
			for (const q of counted.get(self.id) ?? []) {
				if (q.seq >= self.seq) break;
				// Too far wherever it stood: no need to ask the ground where it did.
				const span =
					r.fast(Math.min(q.s + q.reach, r.length)) -
					r.fast(Math.max(q.s - q.reach, 0));
				if (Math.abs(t - r.fast(q.s)) - span >= need) continue;
				if (q.at === undefined) q.decide();
				if (
					q.at !== null &&
					q.at !== undefined &&
					Math.abs(t - r.fast(q.at)) < need
				)
					return true;
			}
			return false;
		}

		/** Stands `kind` `off` metres to `side` of metre `s`, trying ±60 m along the road: the metre it would stand at, or null. */
		function put(
			g: ReturnType<typeof group>,
			kind: KitKind & PieceKind,
			cls: Class,
			s: number,
			side: number,
			off: number,
			need: number,
			slot: number,
			self: Item | null,
			extra: Partial<Piece> = {},
		): number | null {
			for (const shift of SHIFTS) {
				const at = s + shift;
				if (at < 0 || at > r.length) continue;
				if (self && tooSoon(self, at)) return null;
				const p = w.at(at);
				// The keyed side first, then across: on a mountainside one side is often a fill too steep to stand on.
				for (const hand of [side, -side]) {
					const x = p.x + p.lx * off * hand;
					const z = p.z + p.lz * off * hand;
					if (!ground.clearOf(x, z, need) || biomeAt(x, z) === null) continue;
					const turn =
						extra.turn ??
						facing(at, hand, Math.round((u(slot, 90) - 0.5) * 14));
					const placed = placer.candidate(kind, cls, x, z, turn);
					if (placed === null) continue;
					const colourway = extra.flag?.toString();
					const pass: Passing | undefined = self
						? {
								id: placed.id,
								kind,
								colourway,
								size: SIZE[kind] ?? 'small',
								along: at,
								side: hand < 0 ? -1 : 1,
								offset: off,
								source: 'generated',
								at: [x, z],
							}
						: undefined;
					g.out.push({
						p: placed,
						rank: RANK.piece + u(slot, 91),
						is: {
							piece: { kind, x, y: placed.base, z, turn, ...extra },
							line: k,
							pass,
						},
					});
					return at;
				}
			}
			return null;
		}
		/** A sign `off` metres to the right of whoever rides `dir` at metre `s`, facing them. */
		function sign(
			s: number,
			dir: 1 | -1,
			off: number,
			look: SignLook,
			lines: string[],
			sw: number,
			sh: number,
		) {
			// The profile's length is rounded to the centimetre: a foot at the stroke's end may read past it by that much.
			if (s < 0 || s > r.length + 0.01) return;
			const p = w.at(s);
			const x = p.x - p.lx * off * dir;
			const z = p.z - p.lz * off * dir;
			const turn = dir > 0 ? turnBy(p.along, deg(180)) : p.along;
			signs.push({
				sign: { x, z, turn, lines, look, w: sw, h: sh },
				line: k,
				// A sign's face is seen by its own traffic only: its words and its direction are its identity.
				pass: {
					id: `${look}@${Math.round(x * 100)}:${Math.round(z * 100)}`,
					kind: look,
					variant: `${lines.join('|')}|${dir}`,
					size: 'small',
					along: s,
					side: dir > 0 ? -1 : 1,
					offset: off,
					source: 'generated',
					at: [x, z],
				},
			});
		}

		// Small, every 20–40 s uphill: the kinds in a keyed round.
		const round = [...SMALL_KINDS].sort(
			(a, b) =>
				unit(key(stroke, -1, SMALL_KINDS.indexOf(a))) -
				unit(key(stroke, -1, SMALL_KINDS.indexOf(b))),
		);
		const small = (i: number) =>
			r.at((i + 0.5) * SMALL.every + (u(i, 0) - 0.5) * 2 * SMALL.spread);
		for (let i = 0; (i + 0.5) * SMALL.every < r.total; i++) {
			const kind = round[i % round.length];
			const s = small(i);
			const side = u(i, 1) < 0.5 ? -1 : 1;
			const off = 9.5 + u(i, 2) * 7;
			const g = filed(s);
			item(g, kind, s, 60, (self) => {
				const p = w.at(s);
				if (
					!fits[kind](biomeAt(p.x + p.lx * off * side, p.z + p.lz * off * side))
				)
					return null;
				return put(g, kind, 'kit', s, side, off, 9.2, i, self);
			});
		}

		// Medium, every 3–5 min uphill: a farmstead or a fountain, alternately.
		const medium = (m: number) =>
			r.at(
				(m + 0.5) * MEDIUM.every + (u(1e6 + m, 0) - 0.5) * 2 * MEDIUM.spread,
			);
		for (let m = 0; (m + 0.5) * MEDIUM.every < r.total; m++) {
			const slot = 1e6 + m;
			const kind = MEDIUM_KINDS[m % MEDIUM_KINDS.length];
			const s = medium(m);
			const side = u(slot, 1) < 0.5 ? -1 : 1;
			const g = filed(s);
			if (kind === 'fountain') {
				const f = item(g, 'fountain', s, 60, (self) =>
					put(g, 'fountain', 'kit', s, side, 10.5, 9.5, slot, self),
				);
				item(g, 'signpost', s + 5, 60, (self) =>
					f.at === null
						? null
						: put(g, 'signpost', 'kit', s + 5, 1, 10, 9.2, sub(slot, 1), self),
				);
				continue;
			}
			const home = item(g, 'house', s, 60, (self) => {
				const p = w.at(s);
				if (
					biomeAt(p.x + p.lx * 60 * side, p.z + p.lz * 60 * side) !==
					Biome.Meadow
				)
					return null;
				return put(g, 'house', 'building', s, side, 30, 14, slot, self);
			});
			/** A member of the farmstead, `by` metres along from where its house stood. */
			const member = (
				kind: KitKind & PieceKind,
				cls: Class,
				by: number,
				off: number,
				need: number,
				n: number,
			) =>
				item(g, kind, s + by, 120, (self) =>
					home.at === null || home.at === undefined
						? null
						: put(
								g,
								kind,
								cls,
								home.at + by,
								side,
								off,
								need,
								sub(slot, n),
								self,
							),
				);
			member('barn', 'building', 22, 44, 16, 1);
			member('woodpile', 'kit', -8, 23, 12, 2);
			member('bales', 'kit', -30, 40, 12, 3);
			item(g, 'herd', s + 30, 60, (self) => {
				if (home.at === null || home.at === undefined) return null;
				const at = home.at;
				if (tooSoon(self, at + 30)) return null;
				const herd = 3 + Math.floor(u(slot, 3) * 4);
				const facingHerd = deg(Math.floor(u(slot, 4) * 360));
				const cow = w.at(at + 30);
				const from = g.out.length;
				for (let h = 0; h < herd; h++)
					put(
						g,
						'cow',
						'kit',
						at + 30 + h * 4,
						side,
						55 + u(slot, 10 + h) * 25,
						20,
						sub(slot, 4 + h),
						null,
						{
							turn: turnBy(
								facingHerd,
								deg(Math.round((u(slot, 20 + h) - 0.5) * 80)),
							),
						},
					);
				if (g.out.length === from) return null;
				// The herd is one thing to O9: every cow carries it, and the streams count it once.
				const pass: Passing = {
					id: `herd@${k}:${slot}`,
					kind: 'herd',
					size: 'medium',
					along: at + 30,
					side: side < 0 ? -1 : 1,
					offset: 65,
					source: 'generated',
					at: [cow.x, cow.z],
				};
				for (const one of g.out.slice(from)) one.is.pass = pass;
				return at + 30;
			});
		}

		// A chapel under a linden, 15 min apart uphill.
		const chapel = (q: number) =>
			r.at((q + 0.5) * CHAPEL + (u(2e6 + q, 0) - 0.5) * 120);
		for (let q = 0; (q + 0.5) * CHAPEL < r.total; q++) {
			const slot = 2e6 + q;
			const s = chapel(q);
			const side = u(slot, 1) < 0.5 ? -1 : 1;
			const g = filed(s);
			const ch = item(g, 'chapel', s, 60, (self) =>
				put(g, 'chapel', 'building', s, side, 28, 18, slot, self),
			);
			const beside = (
				kind: KitKind & PieceKind,
				by: number,
				off: number,
				need: number,
				n: number,
			) =>
				item(g, kind, s + by, 120, (self) =>
					ch.at === null || ch.at === undefined
						? null
						: put(
								g,
								kind,
								'kit',
								ch.at + by,
								side,
								off,
								need,
								sub(slot, n),
								self,
							),
				);
			beside('linden', 10, 40, 22, 1);
			beside('bench', -4, 11, 9.2, 2);
		}

		// Climbs, whichever way the stroke climbs: a board at the foot for whoever climbs it, hairpins numbered from the top.
		const road = strokeRoad(line);
		const pins = hairpinsOf(road);
		for (const dir of [1, -1] as const) {
			const climbs = climbsOf(dir > 0 ? road : turnedRound(road));
			for (const cl of climbs) {
				const [foot, top] =
					dir > 0
						? [cl.startM, cl.topM]
						: [road.length - cl.startM, road.length - cl.topM];
				const len = cl.topM - cl.startM;
				sign(
					foot,
					dir,
					7,
					'climb',
					[
						`${(len / 1000).toFixed(1)} km`,
						`${((cl.gainM / len) * 100).toFixed(1)} % avg`,
					],
					1.8,
					1.0,
				);
				const inside = pins
					.filter((d) => (d - foot) * dir > 0 && (top - d) * dir > 0)
					.sort((a, b) => (a - b) * dir);
				inside.forEach((d, n) =>
					sign(d, dir, 6.5, 'hairpin', [`${inside.length - n}`], 0.7, 0.7),
				);
			}
			// A pass: where this way's climb tops out and the other way's does too.
			if (dir < 0) continue;
			const back = climbsOf(turnedRound(road)).map(
				(cl) => road.length - cl.topM,
			);
			for (const cl of climbs) {
				if (!back.some((t) => Math.abs(t - cl.topM) < 200)) continue;
				const s = cl.topM;
				const p = w.at(s);
				const here = tileNames(p.x, p.z);
				names ??= here;
				const top = `${Math.round(p.h)} m`;
				const g = filed(s);
				const at = (
					kind: KitKind & PieceKind,
					cls: Class,
					by: number,
					side: number,
					off: number,
					need: number,
					slot: number,
					extra: Partial<Piece> = {},
				) =>
					item(
						g,
						kind,
						s + by,
						60,
						(self) =>
							put(g, kind, cls, s + by, side, off, need, slot, self, extra),
						extra.flag?.toString(),
					);
				at('hut', 'building', 18, -1, 22, 15, 3e6);
				at('bench', 'kit', 6, 1, 10, 9.2, sub(3e6, 1));
				at('signpost', 'kit', -8, 1, 10.5, 9.2, sub(3e6, 2));
				for (let f = 0; f < FLAGS; f++)
					at('flag', 'kit', -14 + f * 5, -1, 11, 10, sub(3e6, 3 + f), {
						flag: f,
					});
				sign(s - 30, 1, 5.2, 'pass', [here.pass, top], 2.6, 1.1);
				sign(s + 30, -1, 5.2, 'pass', [here.pass, top], 2.6, 1.1);
				arches.push({
					x: p.x,
					z: p.z,
					turn: p.along,
					label: `KOM · ${here.pass.toUpperCase()}`,
				});
			}
		}

		// Villages on this stroke: a fountain, a bench, a linden, and a sign each way on the way in.
		for (const v of c.villages.filter((v) => v.line === k)) {
			const slot = 4e6 + Math.round(v.s);
			const g = filed(v.s);
			const at = (
				kind: KitKind & PieceKind,
				by: number,
				side: number,
				off: number,
				need: number,
				n: number,
			) =>
				item(g, kind, v.s + by, 60, (self) =>
					put(g, kind, 'kit', v.s + by, side, off, need, n, self),
				);
			at('fountain', 12, -1, 10.5, 9.5, slot);
			at('bench', -20, 1, 10.5, 9.2, sub(slot, 1));
			at('linden', 40, 1, 26, 14, sub(slot, 2));
			sign(v.s - 200, 1, 5.8, 'village', [v.name], 1.9, 0.55);
			sign(v.s + 200, -1, 5.8, 'village', [v.name], 1.9, 0.55);
		}

		// Road furniture from the stroke's start, a stretch at a time: snow poles every 25 m above 1,100 m
		// where the ground falls away, delineators every 50 m, both sides, 0.5 m outside the edge line.
		for (let a = 0; a <= r.length; a += STRETCH_M) {
			const g = filed(a + STRETCH_M / 2);
			g.step(() => {
				for (let s = a; s < a + STRETCH_M && s <= r.length; s += 25) {
					const p = w.at(s);
					if (p.h <= 1100) continue;
					const fall =
						heightAt(p.x + p.lx * 8, p.z + p.lz * 8) <
						heightAt(p.x - p.lx * 8, p.z - p.lz * 8)
							? 1
							: -1;
					put(g, 'snowpole', 'furniture', s, fall, 4.4, 0, 5e6 + s, null);
				}
				for (let s = a; s < a + STRETCH_M && s <= r.length; s += 50)
					for (const side of [-1, 1]) {
						const p = w.at(s);
						const x = p.x + p.lx * 3.7 * side;
						const z = p.z + p.lz * 3.7 * side;
						const placed = placer.candidate(
							'delineator',
							'furniture',
							x,
							z,
							p.along,
						);
						if (placed)
							g.out.push({
								p: placed,
								rank: RANK.piece + u(6e6 + s, side),
								is: {
									piece: {
										kind: 'delineator',
										x,
										y: placed.base,
										z,
										turn: p.along,
									},
									line: k,
								},
							});
					}
			});
		}
	});

	const first = ground.lines[0];
	const shown = new Map<string, { signs: Sign[]; arches: Arch[] }>();
	return {
		names: names ?? tileNames(first?.x[0] ?? 0, first?.z[0] ?? 0),
		/** The set pieces tile (ti, tj) might stand: every group planned in it or beside it, where it would stand in it. */
		tile(ti: number, tj: number): Candidate<Standing>[] {
			const out: Candidate<Standing>[] = [];
			for (let dj = -1; dj <= 1; dj++)
				for (let di = -1; di <= 1; di++)
					for (const g of groups.get(tileKey(ti + di, tj + dj)) ?? [])
						for (const cand of g.all()) {
							const [a, b] = tileOf(cand.is.piece.x, cand.is.piece.z, origin);
							if (a === ti && b === tj) out.push(cand);
						}
			return out;
		},
		/** The signs and arches in tile (ti, tj), standing on its ground: nothing to gate, only to read. */
		boards(ti: number, tj: number): { signs: Sign[]; arches: Arch[] } {
			const id = tileKey(ti, tj);
			const done = shown.get(id);
			if (done) return done;
			const mine = (x: number, z: number) =>
				tileKey(...tileOf(x, z, origin)) === id;
			const out = {
				signs: signs
					.filter((g) => mine(g.sign.x, g.sign.z))
					.map((g) => ({ ...g.sign, y: heightAt(g.sign.x, g.sign.z) })),
				arches: arches
					.filter((a) => mine(a.x, a.z))
					.map((a) => ({ ...a, y: heightAt(a.x, a.z) })),
			};
			shown.set(id, out);
			return out;
		},
		/** What a rider passes along each stroke, as #3221's O9 reads it, of what stood: furniture aside, a herd as one. */
		streams(stood: readonly Standing[]): Passing[][] {
			const out: Passing[][] = ground.lines.map(() => []);
			const seen = new Set<string>();
			for (const { line, pass } of stood)
				if (pass && !seen.has(pass.id)) {
					seen.add(pass.id);
					out[line].push(pass);
				}
			for (const g of signs) out[g.line].push(g.pass);
			return out;
		},
	};
}

export type SetPieces = ReturnType<typeof setPieces>;
