// Set pieces by place (#3077, ADR-0081): each stroke walked from its
// canonical start, every decision keyed by the stroke, its slot and the
// decision's number, so a descender meets the objects a climber met, only
// sooner. The rhythm is per metre at the uphill reference pace — something
// small every 20–40 s, something medium every 3–5 min, a chapel 15 min apart
// — and a piece is skipped where #3221's O9 would find its kind too near the
// last one stood on the stroke, measured at the faster direction's pace.
// Signs stand for their own traffic: a climb board at the foot for whoever
// climbs it, hairpins numbered from the top, a pass's sign each way.
// Everything stands through #3219's gates.
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

export function setPieces(c: Ctx): {
	pieces: Piece[];
	signs: Sign[];
	arches: Arch[];
	names: Names;
	/** What a rider passes along each stroke, as #3221's O9 reads it: furniture aside, a herd as one. */
	streams: Passing[][];
} {
	const { salt, ground, heightAt, biomeAt, placer } = c;
	const [e0, n0] = c.origin ?? [0, 0];
	const pieces: Piece[] = [];
	const signs: Sign[] = [];
	const arches: Arch[] = [];
	const streams: Passing[][] = [];
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

	ground.lines.forEach((line, k) => {
		const stroke = hashOf(line.key);
		const r = rhythmOf(line);
		const w = r.walk;
		const stream: Passing[] = [];
		streams.push(stream);
		/** Whether O9 would find this kind too near the last of it on the stroke. */
		const tooSoon = (
			kind: PieceKind | 'herd',
			at: number,
			colourway?: string,
		) =>
			stream.some(
				(q) =>
					q.kind === kind &&
					q.colourway === colourway &&
					Math.abs(r.fast(at) - r.fast(q.along)) <
						Math.max(RHYTHM.apart[SIZE[kind] ?? 'small'], RHYTHM.apart[q.size]),
			);
		const pass = (
			kind: PieceKind | 'herd',
			at: number,
			side: number,
			off: number,
			x: number,
			z: number,
			colourway?: string,
		) =>
			stream.push({
				id: `${kind}-${stream.length}`,
				kind,
				colourway,
				size: SIZE[kind] ?? 'small',
				along: at,
				side: side < 0 ? -1 : 1,
				offset: off,
				source: 'generated',
				at: [x, z],
			});
		const u = (slot: number, d: number) => unit(key(stroke, slot, d));
		/** The n-th piece of a slot's group, as a slot of its own. */
		const sub = (slot: number, n: number) => slot * 16 + n;
		/** Faces the road from `side`, turned a little by `jitter` degrees. */
		const facing = (s: number, side: number, jitter = 0): Turn =>
			turnBy(turnBy(w.at(s).along, deg(side > 0 ? -90 : 90)), deg(jitter));

		/** Stands `kind` `off` metres to `side` of metre `s`, trying ±60 m along the road; the metre it stood at, or null. */
		function put(
			kind: KitKind & PieceKind,
			cls: Class,
			s: number,
			side: number,
			off: number,
			need: number,
			slot: number,
			extra: Partial<Piece> = {},
		) {
			for (const shift of [0, 15, -15, 30, -30, 45, -45, 60, -60]) {
				const at = s + shift;
				if (at < 0 || at > r.length) continue;
				const colourway = extra.flag?.toString();
				const counted = cls !== 'furniture' && kind !== 'cow';
				if (counted && tooSoon(kind, at, colourway)) return null;
				const p = w.at(at);
				// The keyed side first, then across: on a mountainside one side is often a fill too steep to stand on.
				for (const hand of [side, -side]) {
					const x = p.x + p.lx * off * hand;
					const z = p.z + p.lz * off * hand;
					if (!ground.clearOf(x, z, need) || biomeAt(x, z) === null) continue;
					const turn =
						extra.turn ??
						facing(at, hand, Math.round((u(slot, 90) - 0.5) * 14));
					const base = placer.stand(kind, cls, x, z, turn);
					if (base === null) continue;
					pieces.push({ kind, x, y: base, z, turn, ...extra });
					if (counted) pass(kind, at, hand, off, x, z, colourway);
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
			signs.push({ x, y: heightAt(x, z), z, turn, lines, look, w: sw, h: sh });
			// A sign's face is seen by its own traffic only: its words and its direction are its identity.
			stream.push({
				id: `${look}-${stream.length}`,
				kind: look,
				variant: `${lines.join('|')}|${dir}`,
				size: 'small',
				along: s,
				side: dir > 0 ? -1 : 1,
				offset: off,
				source: 'generated',
				at: [x, z],
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
			const p = w.at(s);
			if (
				!fits[kind](biomeAt(p.x + p.lx * off * side, p.z + p.lz * off * side))
			)
				continue;
			put(kind, 'kit', s, side, off, 9.2, i);
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
			if (kind === 'fountain') {
				if (put('fountain', 'kit', s, side, 10.5, 9.5, slot) !== null)
					put('signpost', 'kit', s + 5, 1, 10, 9.2, sub(slot, 1));
				continue;
			}
			const p = w.at(s);
			if (
				biomeAt(p.x + p.lx * 60 * side, p.z + p.lz * 60 * side) !== Biome.Meadow
			)
				continue;
			const at = put('house', 'building', s, side, 30, 14, slot);
			if (at === null) continue;
			put('barn', 'building', at + 22, side, 44, 16, sub(slot, 1));
			put('woodpile', 'kit', at - 8, side, 23, 12, sub(slot, 2));
			put('bales', 'kit', at - 30, side, 40, 12, sub(slot, 3));
			const herd = 3 + Math.floor(u(slot, 3) * 4);
			if (tooSoon('herd', at + 30)) continue;
			const facingHerd = deg(Math.floor(u(slot, 4) * 360));
			let grazing = 0;
			for (let h = 0; h < herd; h++)
				if (
					put(
						'cow',
						'kit',
						at + 30 + h * 4,
						side,
						55 + u(slot, 10 + h) * 25,
						20,
						sub(slot, 4 + h),
						{
							turn: turnBy(
								facingHerd,
								deg(Math.round((u(slot, 20 + h) - 0.5) * 80)),
							),
						},
					) !== null
				)
					grazing++;
			const cow = w.at(at + 30);
			if (grazing > 0) pass('herd', at + 30, side, 65, cow.x, cow.z);
		}

		// A chapel under a linden, 15 min apart uphill.
		const chapel = (q: number) =>
			r.at((q + 0.5) * CHAPEL + (u(2e6 + q, 0) - 0.5) * 120);
		for (let q = 0; (q + 0.5) * CHAPEL < r.total; q++) {
			const slot = 2e6 + q;
			const s = chapel(q);
			const side = u(slot, 1) < 0.5 ? -1 : 1;
			const at = put('chapel', 'building', s, side, 28, 18, slot);
			if (at === null) continue;
			put('linden', 'kit', at + 10, side, 40, 22, sub(slot, 1));
			put('bench', 'kit', at - 4, side, 11, 9.2, sub(slot, 2));
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
				put('hut', 'building', s + 18, -1, 22, 15, 3e6);
				put('bench', 'kit', s + 6, 1, 10, 9.2, sub(3e6, 1));
				put('signpost', 'kit', s - 8, 1, 10.5, 9.2, sub(3e6, 2));
				for (let f = 0; f < FLAGS; f++)
					put('flag', 'kit', s - 14 + f * 5, -1, 11, 10, sub(3e6, 3 + f), {
						flag: f,
					});
				sign(s - 30, 1, 5.2, 'pass', [here.pass, top], 2.6, 1.1);
				sign(s + 30, -1, 5.2, 'pass', [here.pass, top], 2.6, 1.1);
				const y = heightAt(p.x, p.z);
				arches.push({
					x: p.x,
					y,
					z: p.z,
					turn: p.along,
					label: `KOM · ${here.pass.toUpperCase()}`,
				});
			}
		}

		// Villages on this stroke: a fountain, a bench, a linden, and a sign each way on the way in.
		for (const v of c.villages.filter((v) => v.line === k)) {
			const slot = 4e6 + Math.round(v.s);
			put('fountain', 'kit', v.s + 12, -1, 10.5, 9.5, slot);
			put('bench', 'kit', v.s - 20, 1, 10.5, 9.2, sub(slot, 1));
			put('linden', 'kit', v.s + 40, 1, 26, 14, sub(slot, 2));
			sign(v.s - 200, 1, 5.8, 'village', [v.name], 1.9, 0.55);
			sign(v.s + 200, -1, 5.8, 'village', [v.name], 1.9, 0.55);
		}

		// Road furniture from the stroke's start: snow poles every 25 m above 1,100 m where the ground falls away,
		// delineators every 50 m, both sides, 0.5 m outside the edge line.
		for (let s = 0; s <= r.length; s += 25) {
			const p = w.at(s);
			if (p.h <= 1100) continue;
			const fall =
				heightAt(p.x + p.lx * 8, p.z + p.lz * 8) <
				heightAt(p.x - p.lx * 8, p.z - p.lz * 8)
					? 1
					: -1;
			put('snowpole', 'furniture', s, fall, 4.4, 0, 5e6 + s);
		}
		for (let s = 0; s <= r.length; s += 50)
			for (const side of [-1, 1]) {
				const p = w.at(s);
				const x = p.x + p.lx * 3.7 * side;
				const z = p.z + p.lz * 3.7 * side;
				const base = placer.stand('delineator', 'furniture', x, z, p.along);
				if (base !== null)
					pieces.push({ kind: 'delineator', x, y: base, z, turn: p.along });
			}
	});

	const first = ground.lines[0];
	return {
		pieces,
		signs,
		arches,
		streams,
		names: names ?? tileNames(first?.x[0] ?? 0, first?.z[0] ?? 0),
	};
}
