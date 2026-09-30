import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD_SALT } from './place/network.test-helper';
import { unmatched, type Thing } from './place/shared';
import { apart, clock, crowded, type Profile } from './placement/stream';
import { createPlacer } from './props/placer';
import { walker } from './props/roads';
import { villageSites } from './props/scatter';
import { hashSeed } from './rand';
import { setPieces } from './setpieces';
import { build, origin, routeLines } from './terrain/network.test-helper';
import type { Line } from './terrain/lines';
import type { Turn } from './props/roads';
import { BUILD_MS } from './world.test-helper';

/**
 * Set pieces by place (#3077): the same pieces, signs and arches in the same
 * place whichever route reaches it (#3226), spaced by riding time and kept
 * apart as #3221's O9 asks, riding either way.
 */

function setOf(lines: Line[], salt = WORLD_SALT) {
	const w = build(lines, salt);
	const place = {
		salt,
		origin,
		ground: w.ground,
		heightAt: w.terrain.heightAt,
		biomeAt: w.terrain.biomeAt,
		chunks: w.cover.chunks,
	};
	const placer = createPlacer(
		(x, z) => w.ground.roadSurfaceAt(x, z) ?? w.terrain.heightAt(x, z),
		w.ground.lines,
	);
	return {
		lines: w.ground.lines,
		...setPieces({ ...place, placer, villages: villageSites(place) }),
	};
}

const facing = (t: Turn) =>
	Math.round((Math.atan2(t[1], t[0]) * 180) / Math.PI);
const thing = (kind: string, x: number, z: number, text?: string): Thing => ({
	kind,
	frame: 'LV95',
	e: origin[0] + x,
	n: origin[1] - z,
	text,
});
const things = (s: ReturnType<typeof setOf>): Thing[] => [
	...s.pieces.map((p) =>
		thing(`${p.kind}@${facing(p.turn)}`, p.x, p.z, p.flag?.toString()),
	),
	...s.signs.map((g) =>
		thing(`${g.look}@${facing(g.turn)}`, g.x, g.z, g.lines.join('|')),
	),
	...s.arches.map((a) => thing(`arch@${facing(a.turn)}`, a.x, a.z, a.label)),
];

/** A stroke's heights every 10 m from its start: what O9's clock reads. */
function profileOf(line: Line): Profile {
	const w = walker(line);
	const n = Math.floor(w.length / 10) + 1;
	return {
		step: 10,
		heights: Array.from({ length: n }, (_, i) => w.at(i * 10).h),
	};
}

describe('the same place stands the same set pieces (#3226)', () => {
	let A: ReturnType<typeof setOf>;
	let B: Thing[];
	let C: Thing[];
	beforeAll(() => {
		A = setOf(routeLines.A());
		B = things(setOf(routeLines.B()));
		C = things(setOf(routeLines.C()));
	}, 60_000);

	it('stands pieces of every size, and signs for whoever climbs', () => {
		const kinds = new Set(A.pieces.map((p) => p.kind));
		for (const k of ['bench', 'signpost', 'fountain', 'delineator'])
			expect(kinds).toContain(k);
		expect(A.signs.some((g) => g.look === 'climb')).toBe(true);
	});

	it('matches every piece, sign and arch within 1 cm, facing the same way, whichever route asks', () => {
		const a = things(A);
		expect(unmatched(a, B)).toBe(0);
		expect(unmatched(a, C)).toBe(0);
	});

	it(
		'would not, keyed by another salt',
		() => {
			const a = things(A);
			const other = things(
				setOf(routeLines.B(), [hashSeed('Toyjoch climb'), 1, 2, 3]),
			);
			expect(unmatched(a, other)).toBeGreaterThan(a.length / 2);
		},
		BUILD_MS,
	);

	it('keeps each kind apart as O9 asks, at the faster direction’s pace', () => {
		A.lines.forEach((line, k) => {
			const stream = A.streams[k];
			expect(apart(stream, profileOf(line))).toEqual([]);
			expect(crowded(stream)).toEqual([]);
		});
	});

	it('never leaves a rider longer than the medium interval without a set piece, either way', () => {
		const MEDIUM_MAX = 300; // docs/SPEC.md: medium every 3–5 min
		A.lines.forEach((line, k) => {
			const t = clock(profileOf(line));
			const edges = [
				0,
				...A.streams[k].map((p) => p.along).sort((a, b) => a - b),
				t.length,
			];
			for (let i = 1; i < edges.length; i++) {
				const [a, b] = [edges[i - 1], edges[i]];
				const gap = Math.max(
					t.forward(b) - t.forward(a),
					t.back(b) - t.back(a),
				);
				expect(
					gap,
					`${line.key} ${a.toFixed(0)}–${b.toFixed(0)} m`,
				).toBeLessThanOrEqual(MEDIUM_MAX);
			}
		});
	});
});
