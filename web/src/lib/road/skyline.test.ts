import { describe, expect, it } from 'vitest';
import type { Road } from './road';
import {
	aheadFor,
	bandIn,
	chipsIn,
	createAheadEase,
	frameFor,
	gradeStep,
	nodesOf,
	SKYLINE,
	stepsPerTick,
	tileOf,
	tilesIn,
	yOf,
} from './skyline';

/** A road from heights every 20 m. */
const road = (heights: number[]): Road => ({
	length: (heights.length - 1) * 20,
	heights,
	turns: heights.slice(1).map(() => 0),
});
/** A road rising at `pct` % for `m` metres from 500 m. */
const ramp = (pct: number, m: number) =>
	road(
		Array.from({ length: m / 20 + 1 }, (_, i) => 500 + (i * 20 * pct) / 100),
	);
const kph = (v: number) => v / 3.6;

describe('the window (#3059)', () => {
	it('reaches 1.5 km below 15 km/h, 3 km between, 5 km above 40', () => {
		expect(aheadFor(kph(10))).toBe(1500);
		expect(aheadFor(kph(25))).toBe(3000);
		expect(aheadFor(kph(45))).toBe(5000);
	});

	it('eases to a new reach over 10 s, neither jumping nor overshooting', () => {
		const ease = createAheadEase(3000);
		const seen = [ease.step(5000, 0.1)];
		for (let t = 0; t < 12; t += 0.1) seen.push(ease.step(5000, 0.1));
		expect(seen[0]).toBeLessThan(3010);
		expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
		expect(Math.max(...seen)).toBe(5000);
		const early = createAheadEase(3000);
		for (let t = 0; t < 5; t += 0.1) early.step(5000, 0.1);
		expect(early.step(5000, 0)).toBeGreaterThan(3500);
		expect(early.step(5000, 0)).toBeLessThan(4500);
	});

	it('steps once a tick below 8 km/h, and under reduced motion', () => {
		expect(stepsPerTick(kph(7), false)).toBe(true);
		expect(stepsPerTick(kph(9), false)).toBe(false);
		expect(stepsPerTick(kph(30), true)).toBe(true);
	});
});

describe('the five grade steps', () => {
	it.each([
		[-8, 0],
		[0, 0],
		[2.9, 0],
		[3, 1],
		[5.9, 1],
		[6, 2],
		[9, 3],
		[11.9, 3],
		[12, 4],
		[18, 4],
	])('%s %% is step %s', (pct, step) => {
		expect(gradeStep(pct)).toBe(step);
	});
});

describe('the frame', () => {
	it('fills 70 % of the slot with the heights in view, over 120 m at least', () => {
		const climb = ramp(8, 6000);
		const frame = frameFor(climb, 1000, 3000, 1000, 200);
		expect(frame.span).toBeGreaterThan(SKYLINE.spanFloorM);
		expect(yOf(frame, frame.lo)).toBe(200);
		expect(yOf(frame, frame.lo + frame.span)).toBeCloseTo(200 * 0.3, 6);

		const flat = frameFor(ramp(0, 6000), 1000, 3000, 1000, 200);
		expect(flat.span).toBe(SKYLINE.spanFloorM);
	});

	it('maps the window across the slot: 0.5 km behind, the reach ahead', () => {
		const frame = frameFor(ramp(0, 6000), 2000, 3000, 1000, 200);
		expect(frame.fromM).toBe(1500);
		expect(frame.scale).toBeCloseTo(1000 / 3500, 9);
	});
});

describe('the tiles', () => {
	it('are never wider than 4096 px, and only the ones in view are drawn', () => {
		const long = ramp(1, 100_000);
		const frame = frameFor(long, 40_000, 3000, 30_000, 200);
		const tiles = tilesIn(frame, long).map((i) => tileOf(frame, long, i));
		for (const tile of tiles)
			expect(tile.width).toBeLessThanOrEqual(SKYLINE.tilePx);
		expect(tiles[0].left).toBeLessThanOrEqual((40_000 - 500) * frame.scale);
		expect(tiles.at(-1)!.left + tiles.at(-1)!.width).toBeGreaterThanOrEqual(
			(43_000 - 1) * frame.scale,
		);
	});

	it('draws each grade in its own step, and stays under 300 nodes', () => {
		// Flat, then a 10 % wall, then flat: steps 0 and 3 and nothing else.
		const wall = road([
			...Array(50).fill(500),
			...Array.from({ length: 50 }, (_, i) => 500 + (i + 1) * 2),
			...Array(50).fill(600),
		]);
		const frame = frameFor(wall, 1000, 3000, 1000, 200);
		const tiles = tilesIn(frame, wall).map((i) => tileOf(frame, wall, i));
		const used = new Set(
			tiles.flatMap((t) => t.areas.flatMap((a, i) => (a ? [i] : []))),
		);
		expect([...used].sort()).toEqual([0, 3]);
		expect(nodesOf(tiles)).toBeLessThanOrEqual(SKYLINE.maxNodes);

		// A road that changes step every sample is the worst case there is.
		const saw = road(
			Array.from({ length: 2000 }, (_, i) => 500 + (i % 2 ? 3 : 0) + i * 0.01),
		);
		const sawFrame = frameFor(saw, 10_000, 5000, 3000, 200);
		const sawTiles = tilesIn(sawFrame, saw).map((i) =>
			tileOf(sawFrame, saw, i),
		);
		expect(nodesOf(sawTiles)).toBeLessThanOrEqual(SKYLINE.maxNodes);
	});
});

describe('the chips and the band', () => {
	it('puts a classed climb’s chip where it tops out, and none for an unclassed one', () => {
		const climb = ramp(8, 6000);
		const frame = frameFor(climb, 1000, 3000, 1000, 200);
		const chips = chipsIn(frame, climb, [
			{ startM: 500, topM: 3000, gainM: 200, cls: 'II' },
			{ startM: 3200, topM: 3400, gainM: 10, cls: null },
			{ startM: 5000, topM: 5900, gainM: 70, cls: 'IV' },
		]);
		expect(chips).toHaveLength(1);
		expect(chips[0].cls).toBe('II');
		expect(chips[0].x).toBeCloseTo(3000 * frame.scale, 6);
	});

	it('clips the band’s blocks to the window', () => {
		const frame = frameFor(ramp(0, 10_000), 2000, 3000, 1000, 200);
		const blocks = bandIn(frame, [
			{ fromM: 0, toM: 1600, zone: 2 },
			{ fromM: 1600, toM: 4000, zone: 4 },
			{ fromM: 9000, toM: 10_000, zone: 5 },
		]);
		expect(blocks.map((b) => b.zone)).toEqual([2, 4]);
		expect(blocks[0].x).toBeCloseTo(1500 * frame.scale, 6);
		expect(blocks[0].width).toBeCloseTo(100 * frame.scale, 6);
	});
});
