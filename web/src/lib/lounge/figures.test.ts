import { describe, expect, it } from 'vitest';
import type { LiveRider } from '$lib/channel/types';
import { crewOf, floorSpots } from '$lib/lounge/figures';
import { SCENE_H, SCENE_W, SPOT_DX, middleOf, tagsOf } from '$lib/lounge/scene';

const rider = (name: string, extra: Partial<LiveRider> = {}) =>
	({
		id: name,
		name,
		inVoice: true,
		speaking: false,
		watts: 0,
		...extra,
	}) as LiveRider;

describe('who sits where in the lounge', () => {
	it('puts a rider on a trainer, four on the sofa and the rest round the rug', () => {
		const riders = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) =>
			rider(n, { riding: n === 'c', watts: n === 'c' ? 180 : 0 }),
		);
		const crew = crewOf(riders, 0, SCENE_W, SCENE_H);
		expect(crew.bikes.map((b) => b.rider?.id)).toEqual(['c', undefined]);
		expect(crew.seated.map((f) => f.id)).toEqual(['a', 'b', 'd', 'e']);
		expect(crew.floor.map((c) => c.f.id)).toEqual(['f', 'g', 'h']);
		expect(crew.more).toBe(0);
	});

	it('seats the first on the floor beside the table, then in front of it', () => {
		const [first, second, third] = floorSpots(SCENE_W, SCENE_H);
		expect([first, second].map((p) => p.y)).toEqual([130, 130]);
		expect(Math.abs(first.x - 160)).toBe(Math.abs(second.x - 160));
		expect(third).toEqual({ x: 160, y: 156 });
	});

	it('counts whoever has no spot left', () => {
		const spots = floorSpots(SCENE_W, SCENE_H);
		const riders = Array.from({ length: 4 + spots.length + 3 }, (_, i) =>
			rider(`r${i}`),
		);
		const crew = crewOf(riders, 0, SCENE_W, SCENE_H);
		expect(crew.floor).toHaveLength(spots.length);
		expect(crew.more).toBe(3);
	});

	it('keeps every spot inside the room, apart, and off the furniture', () => {
		for (const [w, h] of [
			[SCENE_W, SCENE_H],
			[400, 278],
			[320, 345],
			[700, 400],
		]) {
			const { ox } = middleOf(w, h);
			const spots = floorSpots(w, h);
			expect(spots.length).toBeGreaterThan(8);
			for (const [i, p] of spots.entries()) {
				expect(p.x + ox).toBeGreaterThanOrEqual(12);
				expect(p.x + ox).toBeLessThanOrEqual(w - 12);
				expect(p.y).toBeLessThanOrEqual(h - 10);
				// Not at the table, and clear of the sofa's front.
				expect(p.y >= 142 || Math.abs(p.x - 160) >= 36).toBe(true);
				expect(p.y >= 112 || p.x <= 98 || p.x >= 222).toBe(true);
				for (const q of spots.slice(i + 1))
					expect(Math.abs(p.x - q.x) >= SPOT_DX / 2 || p.y !== q.y).toBe(true);
			}
		}
	});

	it('grows the floor a phone shows down the page', () => {
		expect(floorSpots(320, 345).length).toBeGreaterThan(
			floorSpots(SCENE_W, SCENE_H).length,
		);
	});

	it('hangs one name under each figure', () => {
		const riders = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) =>
			rider(n, { riding: n === 'a' }),
		);
		const tags = tagsOf(crewOf(riders, 0, 400, 260), 400, 260);
		expect(tags.map((t) => t.id).sort()).toEqual(riders.map((r) => r.id));
	});

	it('gives everyone who rides a trainer, you first, and keeps two in the room', () => {
		const riders = ['a', 'b', 'c', 'd'].map((n) =>
			rider(n, { riding: n !== 'a', you: n === 'd' }),
		);
		const crew = crewOf(riders, 0, 320, 260);
		expect(crew.bikes.map((b) => b.rider?.id)).toEqual(['d', 'b', 'c']);
		expect(crew.seated.map((f) => f.id)).toEqual(['a']);
		expect(crewOf([rider('a')], 0, 320, 260).bikes).toHaveLength(2);
		// Each faces the rug.
		for (const b of crew.bikes) expect(Math.sign(160 - b.x)).toBe(b.face);
	});

	it('wears headphones while the mic is off', () => {
		const crew = crewOf([rider('a', { muted: true })], 0, SCENE_W, SCENE_H);
		expect(crew.seated[0].muted).toBe(true);
	});
});
