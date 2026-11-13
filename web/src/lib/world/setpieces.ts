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
import { keyer, type Salt } from './place/keyed';
import { namesFor, type Names } from './names';
import type { Passing } from './placement/stream';
import type { Placer } from './props/placer';
import type { Turn } from './props/roads';
import type { Village } from './props/scatter';
import { tileKey, tileOf, type Candidate } from './props/tiles';
import type { Biome } from './biome';
import { prng } from './rand';
import { planStroke, type Group } from './setpieces-stroke';
import type { Ground, Origin } from './terrain/ground';
import { indexLines } from './terrain/lines';
import { FORMATION } from './terrain/road-profile';

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
	| 'lamp'
	| 'house'
	| 'barn'
	| 'hut'
	| 'cow'
	| 'steep'
	| 'cattle'
	| 'mirror'
	| 'milkcans'
	| 'cross';
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

export type Ctx = {
	salt: Salt;
	origin?: Origin;
	ground: Ground;
	/** The drawn ground and what grows on it; null where none is drawn. */
	heightAt: (x: number, z: number) => number;
	biomeAt: (x: number, z: number) => Biome | null;
	placer: Placer;
	villages: readonly Village[];
};

/** The tiles a place's set pieces are named by: one name set per 5 km. */
const TILE_M = 5000;

export function setPieces(c: Ctx) {
	const { salt, ground, heightAt } = c;
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
	const groups = new Map<string, Group[]>();
	const signs: { sign: Omit<Sign, 'y'>; line: number; pass: Passing }[] = [];
	const arches: Omit<Arch, 'y'>[] = [];
	const plan = {
		c,
		key,
		tileNames,
		groups,
		signs,
		arches,
		named: (n: Names) => (names ??= n),
		free: offOthers(ground),
	};
	// A roundabout's ring is no stroke: a circle would be signed as one long hairpin.
	ground.lines.forEach(
		(line, k) => line.key.startsWith('ring') || planStroke(line, k, plan),
	);

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

/** Metres past another road's formation that a stroke's things keep. */
export const OTHER_M = 1;
/** Metres round a side road's mouth in which the road it meets stands none of its own things on the mouth's side. */
export const MOUTH_M = 12;

/**
 * Whether stroke `k` may stand something reaching `reach` metres at (x, z):
 * a stroke plans its things off its own road, some just past its edge line,
 * and where another road meets or crosses it they would stand on that road's
 * asphalt. So nothing stands within another road's formation, and the road a
 * side road runs into keeps its posts out of the mouth. One road alone: all.
 */
export function offOthers(
	ground: Pick<Ground, 'lines'>,
): (x: number, z: number, k: number, reach?: number) => boolean {
	const lines = ground.lines;
	if (lines.length < 2) return () => true;
	const index = indexLines(lines);
	// Every road's end that lies in another road: the line met, its segment there, and the side the road comes in from.
	const mouths: {
		x: number;
		z: number;
		on: number;
		a: number;
		side: number;
	}[] = [];
	const sideOf = (a: number, x: number, z: number) => {
		const sx = index.x[a + 1] - index.x[a];
		const sz = index.z[a + 1] - index.z[a];
		return Math.sign(sz * (x - index.x[a]) - sx * (z - index.z[a])) || 1;
	};
	lines.forEach((l, k) => {
		const n = l.x.length - 1;
		for (const end of [0, n]) {
			const hit = index.nearest(l.x[end], l.z[end], 1, k);
			if (!hit || hit.d > FORMATION) continue;
			// A point a little way up the road that comes in says which side it comes from.
			const inside = end === 0 ? Math.min(n, 8) : Math.max(0, n - 8);
			mouths.push({
				x: l.x[end],
				z: l.z[end],
				on: index.lineOf[hit.i],
				a: hit.i,
				side: sideOf(hit.i, l.x[inside], l.z[inside]),
			});
		}
	});
	return (x, z, k, reach = 0) => {
		const hit = index.nearest(x, z, 1, k);
		if (hit && hit.d < FORMATION + OTHER_M + reach) return false;
		return mouths.every(
			(m) =>
				m.on !== k ||
				// Two metres more than is asked of it: a line ends a little inside the road it meets.
				Math.hypot(x - m.x, z - m.z) >= MOUTH_M + 2 + reach ||
				sideOf(m.a, x, z) !== m.side,
		);
	};
}
