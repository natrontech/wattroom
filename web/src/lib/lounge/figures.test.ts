import { describe, expect, it } from 'vitest';
import type { LiveRider } from '$lib/channel/types';
import { crewOf, cushionXs } from '$lib/lounge/figures';
import { SCENE_W, tagsOf } from '$lib/lounge/scene';

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
	it('puts a rider on the bike, five on the sofa and the rest on cushions', () => {
		const riders = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) =>
			rider(n, { riding: n === 'c', watts: n === 'c' ? 180 : 0 }),
		);
		const crew = crewOf(riders, 0, SCENE_W);
		expect(crew.rider?.id).toBe('c');
		expect(crew.seated.map((f) => f.id)).toEqual(['a', 'b', 'd', 'e', 'f']);
		expect(crew.floor.map((c) => c.f.id)).toEqual(['g', 'h']);
		expect(crew.more).toBe(0);
	});

	it('counts whoever has no cushion left', () => {
		const xs = cushionXs(SCENE_W);
		const riders = Array.from({ length: 5 + xs.length + 3 }, (_, i) =>
			rider(`r${i}`),
		);
		const crew = crewOf(riders, 0, SCENE_W);
		expect(crew.floor).toHaveLength(xs.length);
		expect(crew.more).toBe(3);
	});

	it('keeps every cushion inside the room and apart', () => {
		for (const w of [SCENE_W, 400, 700]) {
			const xs = cushionXs(w);
			expect(new Set(xs).size).toBe(xs.length);
			for (const x of xs) {
				expect(x).toBeGreaterThanOrEqual(10);
				expect(x).toBeLessThanOrEqual(w - 10);
			}
		}
	});

	it('hangs one name under each figure', () => {
		const riders = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) =>
			rider(n, { riding: n === 'a' }),
		);
		const tags = tagsOf(crewOf(riders, 0, 400), 400, 260);
		expect(tags.map((t) => t.id).sort()).toEqual(riders.map((r) => r.id));
	});
});
