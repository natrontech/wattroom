import { beforeAll, describe, expect, it } from 'vitest';
import { HOME_ROADS } from '$lib/ride/home-roads';
import type { Road } from '$lib/road/road';
import { toRoute, type Route } from '$lib/road/route';
import { Biome } from './biome';
import { yOf } from './geometry';
import { kitSpec, PIECE_MODELS, PROP_KINDS, type KitKind } from './props/kit';
import { tileOf } from './props/tiles';
import { routeOfRoad } from './road-route';
import {
	ART,
	BLOCK_M,
	COW_SLOPE_M,
	FOOT,
	reach,
	roadsidePlacer,
	spriteOwns,
	stretchesFor,
	type Spot,
} from './roadside-place';
import { syntheticPoints } from './synthetic';
import { FORMATION } from './terrain/road-profile';
import { generate, type World } from './world';
import { BUILD_MS, longLoopPoints } from './world.test-helper';

describe('the roadside’s stretches', () => {
	it('stands what is ahead within reach and a little behind, nearest first', () => {
		expect(stretchesFor(1000, 100_000, false)).toEqual([3, 4, 5, 2]);
	});

	it('keeps a few stretches on a long road, never the whole of it', () => {
		expect(stretchesFor(50_000, 200_000, false).length).toBeLessThanOrEqual(4);
	});

	it('stops at the road’s ends', () => {
		expect(stretchesFor(0, 100_000, false)).toEqual([0, 1]);
		expect(stretchesFor(99_900, 100_000, false)).toEqual([333, 332]);
	});

	it('wraps a loop round to its start', () => {
		expect(stretchesFor(5900, 6000, true)).toEqual([19, 0, 1]);
		expect(stretchesFor(6050, 6000, true)).toEqual([0, 1, 19]);
	});

	it('takes the start for a rider with no place yet', () => {
		expect(stretchesFor(-Infinity, 6000, false)).toEqual([0, 1]);
	});
});

/** Stacked switchbacks (switchbacks.test.ts): 600 m legs about 60 m apart, each turned 180° over 100 m. */
function stacked(legs: number): Road {
	const heights = [100];
	const turns: number[] = [];
	for (let leg = 0; leg < legs; leg++) {
		for (let s = 0; s < 30; s++) turns.push(0);
		if (leg < legs - 1)
			for (let s = 0; s < 5; s++) turns.push(leg % 2 ? -36 : 36);
	}
	for (let i = 0; i < turns.length; i++) heights.push(heights[i] + 0.065 * 20);
	return { length: turns.length * 20, heights, turns };
}

/** A road that comes round a full circle back onto its own line, then runs on: it passes its own start of the loop. */
function looped(): Road {
	const turns = [
		...Array(20).fill(0),
		...Array(18).fill(20),
		...Array(20).fill(0),
	];
	const heights = [500];
	for (let i = 0; i < turns.length; i++) heights.push(heights[i] + 0.02 * 20);
	return { length: turns.length * 20, heights, turns };
}

type Case = { name: string; route: Route; world: World; stretches: number[] };
const cases: Case[] = [];

/** Metres from (x, z) to the nearest of the world's roads, every segment of it. */
function roadDistance(world: World, x: number, z: number): number {
	let best = Infinity;
	for (const line of world.roads)
		for (let i = 0; i + 1 < line.x.length; i++) {
			const ax = line.x[i];
			const az = line.z[i];
			const dx = line.x[i + 1] - ax;
			const dz = line.z[i + 1] - az;
			const len = dx * dx + dz * dz;
			const t =
				len > 0
					? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len))
					: 0;
			best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
		}
	return best;
}

const all = (c: Case) => {
	const placer = roadsidePlacer(c.route, c.world);
	return c.stretches.map((b) => placer.spots(b));
};

beforeAll(async () => {
	const add = (name: string, route: Route, stretches?: number[]) => {
		const last = Math.ceil(route.length / BLOCK_M) - 1;
		cases.push({
			name,
			route,
			world: generate(route),
			stretches: stretches ?? Array.from({ length: last + 1 }, (_, b) => b),
		});
	};
	for (const home of HOME_ROADS)
		add(home.name, toRoute(syntheticPoints(await home.shape())));
	add('stacked switchbacks', routeOfRoad(stacked(4)));
	add('a road round onto itself', routeOfRoad(looped()));
	// A long road, a stretch of it here and there: the roadside holds anywhere along it.
	add('a 124 km loop', toRoute(longLoopPoints()), [0, 1, 2, 150, 151, 412]);
}, BUILD_MS * 4);

describe('where the roadside stands', () => {
	it('keeps every thing its half width off every road, round hairpins and where a road comes back by itself', () => {
		for (const c of cases) {
			const worst = all(c)
				.flat()
				.map((s) => roadDistance(c.world, s.x, s.z) - FORMATION - reach(s.art))
				.reduce((a, b) => Math.min(a, b), Infinity);
			expect(worst, c.name).toBeGreaterThanOrEqual(-0.05);
		}
	}, 120_000);

	it('stands nothing in anything else', () => {
		for (const c of cases) {
			const spots = all(c).flat();
			const grid = new Map<string, Spot[]>();
			const key = (x: number, z: number) =>
				`${Math.floor(x / 3)}:${Math.floor(z / 3)}`;
			for (const s of spots) {
				const k = key(s.x, s.z);
				grid.set(k, [...(grid.get(k) ?? []), s]);
			}
			const touching: string[] = [];
			for (const s of spots) {
				const [i, j] = [Math.floor(s.x / 3), Math.floor(s.z / 3)];
				for (let di = -1; di <= 1; di++)
					for (let dj = -1; dj <= 1; dj++)
						for (const o of grid.get(`${i + di}:${j + dj}`) ?? []) {
							if (o === s) continue;
							const gap =
								Math.hypot(o.x - s.x, o.z - s.z) -
								FOOT[ART[s.art].name] -
								FOOT[ART[o.art].name];
							if (gap < -1e-6)
								touching.push(`${ART[s.art].name}/${ART[o.art].name}`);
						}
			}
			expect(touching, c.name).toEqual([]);
		}
	}, 120_000);

	it('stands nothing inside a house, a sign or anything else the world builds there', () => {
		const kits = new Set<string>([...PROP_KINDS, ...PIECE_MODELS]);
		for (const c of cases) {
			const inside: string[] = [];
			for (const s of all(c).flat()) {
				const [ti, tj] = tileOf(s.x, s.z);
				for (let i = ti - 1; i <= ti + 1; i++)
					for (let j = tj - 1; j <= tj + 1; j++) {
						const t = c.world.tile(i, j);
						const things = [
							...t.props
								.filter((p) => !spriteOwns(c.world, p.kind, p.x, p.z))
								.map((p) => ({ ...p, scale: p.scale })),
							...t.pieces.map((p) => ({ ...p, scale: 1 })),
						];
						for (const p of things) {
							// The contact box's inner circle: inside it is inside the thing, whichever way it is turned.
							const r = kits.has(p.kind)
								? Math.min(
										kitSpec(p.kind as KitKind).hw,
										kitSpec(p.kind as KitKind).hd,
									) * p.scale
								: 0.2;
							if (Math.hypot(p.x - s.x, p.z - s.z) < r + FOOT[ART[s.art].name])
								inside.push(`${ART[s.art].name} in ${p.kind}`);
						}
					}
			}
			expect(inside, c.name).toEqual([]);
		}
	}, 120_000);

	it('stands everything on the ground: nothing floats, and a cow grazes only on a gentle bank', () => {
		for (const c of cases) {
			const off: string[] = [];
			for (const s of all(c).flat()) {
				const ground = yOf(c.route, c.world.heightAt(s.x, s.z));
				const name = ART[s.art].name;
				if (name !== 'cow' && Math.abs(s.y - ground) > 1e-6) off.push(name);
				// A cow stands on its lower end: never over the ground, never sunk past a gentle bank.
				if (
					name === 'cow' &&
					(s.y > ground + 1e-6 || ground - s.y > COW_SLOPE_M * 1.2)
				)
					off.push('a cow off its bank');
			}
			expect(off, c.name).toEqual([]);
		}
	}, 120_000);

	it('grows nothing on water, rock or snow, and no tree above the trees', () => {
		for (const c of cases) {
			const wrong = all(c)
				.flat()
				.filter((s) => {
					const b = c.world.biomeAt(s.x, s.z);
					const tree = ['spruce', 'leafy'].includes(ART[s.art].name);
					return (
						b === null ||
						b === Biome.Water ||
						b === Biome.Rock ||
						b === Biome.Snow ||
						(b === Biome.Alpine && tree)
					);
				});
			expect(wrong.length, c.name).toBe(0);
		}
	}, 120_000);

	it('leaves no stretch of road bare', () => {
		for (const c of cases) {
			const counts = all(c).map((spots, k) => ({
				b: c.stretches[k],
				n: spots.length,
			}));
			// A stretch cut short at the road's end may be bare; a whole one never is.
			const whole = counts.filter(
				({ b }) => (b + 1) * BLOCK_M <= c.route.length,
			);
			expect(Math.min(...whole.map((w) => w.n)), c.name).toBeGreaterThan(10);
		}
	}, 120_000);

	it('stands the same things in the same places whichever stretch is built first, on every screen', () => {
		for (const c of cases) {
			const forward = all(c);
			const fresh = roadsidePlacer(c.route, generate(c.route));
			const backward = [...c.stretches]
				.reverse()
				.map((b) => fresh.spots(b))
				.reverse();
			expect(backward, c.name).toEqual(forward);
		}
	}, 240_000);
});
