import { describe, expect, it } from 'vitest';
import { landUse } from '../land';
import { CHUNK_M } from '../place/lattice';
import {
	at,
	camera,
	network,
	WORLD_SALT,
	type LatLon,
	type Road,
} from '../place/network.test-helper';
import { lv95, originOf } from '../place/project';
import { groundGap, type BuiltWorld } from '../place/shared';
import { hashSeed } from '../rand';
import { around, createTerrain } from '../terrain-mesh';
import { makeGround } from './ground';
import { PATCH_M } from './junctions';
import type { Line } from './lines';

/**
 * The place's ground (#3075) on #3226's synthetic network: a pass with five
 * hairpins, a valley road to its foot and a descent back. Each route lists
 * the roads it knows in its own order and rides them its own way; the
 * ground must not care.
 */

const [ce, cn] = lv95(...camera());
const origin = originOf(ce, cn);
const local = (p: LatLon): [number, number] => {
	const [e, n] = lv95(p[0], p[1]);
	return [e - origin[0], origin[1] - n];
};
const [camX, camZ] = local(camera());

function lineOf(r: Road, back = false, lift = 0): Line {
	const pts = (back ? [...r.points].reverse() : r.points).map(local);
	const hs = back ? [...r.heights].reverse() : r.heights;
	return {
		key: r.key,
		x: pts.map((p) => p[0]),
		z: pts.map((p) => p[1]),
		h: hs.map((v) => v + lift),
	};
}

function build(lines: Line[], salt = WORLD_SALT) {
	const ground = makeGround(lines, { salt, origin });
	const cover = around(ground.lines, camX, camZ);
	const terrain = createTerrain(ground, cover.level, landUse(ground.noise));
	return { ground, cover, terrain };
}

const [climb, valley, descent] = network().roads;
// Each route's own order and direction: the loop, the climb as its own file, the climb ridden down.
const A = build([lineOf(valley), lineOf(climb), lineOf(descent)]);
const B = build([lineOf(climb), lineOf(valley), lineOf(descent)]);
const C = build([lineOf(climb, true), lineOf(descent), lineOf(valley)]);

const world = (w: typeof A): BuiltWorld => ({
	ground: (lat, lon) => w.terrain.heightAt(...local([lat, lon])),
	things: [],
	signs: [],
	arch: null,
	names: [],
	horizon: '',
});

/** B's climb, 300 m clear of its ends: the road, and 50, 200 and 1,000 m either side of it. */
function shared(): LatLon[] {
	const pts = climb.points;
	const xy = pts.map(local);
	const along = [0];
	for (let i = 1; i < xy.length; i++)
		along.push(
			along[i - 1] +
				Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]),
		);
	const out: LatLon[] = [];
	for (let i = 1; i < pts.length - 1; i += 4) {
		if (along[i] < 300 || along.at(-1)! - along[i] < 300) continue;
		const de = xy[i + 1][0] - xy[i - 1][0];
		const dn = xy[i - 1][1] - xy[i + 1][1];
		const len = Math.hypot(de, dn);
		for (const off of [0, 50, 200, 1000])
			for (const s of off ? [-1, 1] : [1])
				out.push(at(pts[i], (-dn / len) * off * s, (de / len) * off * s));
	}
	return out;
}

describe('the same place is the same ground (#3226)', () => {
	const samples = shared();

	it('samples a real stretch', () => {
		expect(samples.length).toBeGreaterThan(40);
	});

	it('agrees to the bit, at the road and 50, 200 and 1,000 m from it, whichever route asks', () => {
		expect(groundGap(world(A), world(B), samples)).toBe(0);
		expect(groundGap(world(A), world(C), samples)).toBe(0);
	});

	it('would not, keyed by the route', () => {
		const byName = build(
			[lineOf(climb), lineOf(valley), lineOf(descent)],
			[hashSeed('Toyjoch climb'), 1, 2, 3],
		);
		expect(groundGap(world(A), world(byName), samples)).toBeGreaterThan(1);
	});
});

// #3226's climb stacks 300 m legs 30 m apart and 47 m apart in height — a
// 1.58 slope before any road is cut into it, which no earthwork makes
// without a retaining wall. The drawn-road checks run on the dev road, whose
// hairpins a road builder would recognise (world.test.ts).
describe('the drawn ground', () => {
	it('meets its neighbours with no crack, wherever fine and coarse ground meet', () => {
		// Every edge a fine chunk shares with a coarse one, from both sides, however it faces.
		const faces = new Map<string, number>();
		let worst = 0;
		const eps = 1e-6;
		for (const [ci, cj] of A.cover.chunks) {
			if (A.cover.level(ci, cj) !== 'fine') continue;
			for (const [di, dj, face] of [
				[-1, 0, 'west'],
				[1, 0, 'east'],
				[0, -1, 'north'],
				[0, 1, 'south'],
			] as const) {
				if (A.cover.level(ci + di, cj + dj) !== 'coarse') continue;
				faces.set(face, (faces.get(face) ?? 0) + 1);
				for (let s = 0.5; s < CHUNK_M; s += 2.5) {
					// The shared edge, and a hair either side of it.
					const [x, z] = di
						? [(ci + (di > 0 ? 1 : 0)) * CHUNK_M, cj * CHUNK_M + s]
						: [ci * CHUNK_M + s, (cj + (dj > 0 ? 1 : 0)) * CHUNK_M];
					const a = A.terrain.heightAt(
						x - Math.abs(di) * eps,
						z - Math.abs(dj) * eps,
					);
					const b = A.terrain.heightAt(
						x + Math.abs(di) * eps,
						z + Math.abs(dj) * eps,
					);
					worst = Math.max(worst, Math.abs(a - b));
				}
			}
		}
		expect([...faces.keys()].sort()).toEqual([
			'east',
			'north',
			'south',
			'west',
		]);
		expect(worst).toBeLessThan(1e-3);
	});
});

describe('where one road ends on another', () => {
	// The lab's junction step: the valley's data 0.7 m higher than the climb's at the spot they share.
	const stepped = build([
		lineOf(valley, false, 0.7),
		lineOf(climb),
		lineOf(descent),
	]);
	const line = (key: string) =>
		stepped.ground.lines.find((l) => l.key === key)!;

	it('the two surfaces meet at one height', () => {
		const v = line('valley');
		const c = line('climb');
		const end = (l: Line, x: number, z: number) => {
			const n = l.x.length - 1;
			return Math.hypot(l.x[0] - x, l.z[0] - z) <
				Math.hypot(l.x[n] - x, l.z[n] - z)
				? 0
				: n;
		};
		const [jx, jz] = local(climb.points[0]);
		expect(Math.abs(v.h[end(v, jx, jz)] - c.h[end(c, jx, jz)])).toBeLessThan(
			1e-9,
		);
	});

	it('reverses neither road on its way through the patch', () => {
		// Up the valley and into the climb, centreline every 2 m across the patch: never downhill.
		const [jx, jz] = local(climb.points[0]);
		const path: [number, number][] = [];
		for (const l of [lineOf(valley), lineOf(climb)])
			for (let i = 0; i < l.x.length - 1; i++) {
				if (Math.hypot(l.x[i] - jx, l.z[i] - jz) > 3 * PATCH_M) continue;
				const len = Math.hypot(l.x[i + 1] - l.x[i], l.z[i + 1] - l.z[i]);
				for (let s = 0; s < len; s += 2)
					path.push([
						l.x[i] + ((l.x[i + 1] - l.x[i]) * s) / len,
						l.z[i] + ((l.z[i + 1] - l.z[i]) * s) / len,
					]);
			}
		const heights = path.map(([x, z]) => stepped.ground.roadSurfaceAt(x, z)!);
		const falls = heights
			.slice(1)
			.filter((h, i) => h < heights[i] - 1e-6).length;
		expect(path.length).toBeGreaterThan(50);
		expect(falls).toBe(0);
	});
});
