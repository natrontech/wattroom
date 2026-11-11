import { describe, expect, it } from 'vitest';
import type { LiveRider } from '#lib/channel/types.ts';
import {
	COOLING_SEC,
	cooled,
	crewOf,
	floorSpots,
	idleOf,
} from '#lib/lounge/figures.ts';
import {
	PLACES,
	SCENE_H,
	SCENE_W,
	SPOT_DX,
	middleOf,
	placeAt,
	tagsOf,
} from '#lib/lounge/scene.ts';

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
		expect(crew.seated.map((f) => f?.id)).toEqual(['a', 'b', 'd', 'e']);
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
		expect(crew.seated.map((f) => f?.id)).toEqual(['a']);
		expect(crewOf([rider('a')], 0, 320, 260).bikes).toHaveLength(2);
		// Each faces the rug.
		for (const b of crew.bikes) expect(Math.sign(160 - b.x)).toBe(b.face);
	});

	it('wears headphones while the mic is off', () => {
		const crew = crewOf([rider('a', { muted: true })], 0, SCENE_W, SCENE_H);
		expect(crew.seated[0]!.muted).toBe(true);
	});

	it('hands a towel to whoever just stopped riding, and takes it back', () => {
		const on = [{ id: 'a', riding: 'free' }, { id: 'b' }];
		const off = [{ id: 'a' }, { id: 'b' }];
		const first = cooled(on, new Set(), new Map(), 0);
		expect([...first.until]).toEqual([]);
		const ended = cooled(off, first.riding, first.until, 10);
		expect(ended.until.get('a')).toBe(10 + COOLING_SEC);
		expect(ended.until.has('b')).toBe(false);
		const back = cooled(on, ended.riding, ended.until, 20);
		expect(back.until.has('a')).toBe(false);
		const later = cooled(off, new Set(), ended.until, 10 + COOLING_SEC + 1);
		expect(later.until.size).toBe(0);
	});

	it('keeps a seat for whoever took it, and fills in round them', () => {
		const crew = crewOf(
			[rider('a'), rider('b', { seat: 3 }), rider('c')],
			0,
			SCENE_W,
			SCENE_H,
		);
		expect(crew.seated.map((f) => f?.id)).toEqual(['a', 'c', 'b']);
		const gap = crewOf([rider('a', { seat: 4 })], 0, SCENE_W, SCENE_H);
		expect(gap.seated.map((f) => f?.id)).toEqual([
			undefined,
			undefined,
			undefined,
			'a',
		]);
		expect(tagsOf(gap, SCENE_W, SCENE_H)).toHaveLength(1);
	});

	it('gives a place to the first who took it, and what it is for', () => {
		const crew = crewOf(
			[rider('a', { seat: 6 }), rider('b', { seat: 6 })],
			0,
			SCENE_W,
			SCENE_H,
		);
		expect(crew.placed.map(({ f }) => [f.id, f.doing])).toEqual([
			['a', 'warm'],
		]);
		expect(crew.seated.map((f) => f?.id)).toEqual(['b']);
	});

	it('leaves a tall room’s places to a tall room', () => {
		const seat = PLACES.find((p) => p.front)!.seat;
		const low = crewOf([rider('a', { seat })], 0, SCENE_W, SCENE_H);
		expect(low.placed).toEqual([]);
		expect(low.seated.map((f) => f?.id)).toEqual(['a']);
		const tall = crewOf([rider('a', { seat })], 0, 370, 316);
		expect(tall.placed).toHaveLength(1);
	});

	it('takes a seat from a click', () => {
		expect(placeAt(148, 70)).toBe(2);
		expect(placeAt(203, 100)).toBe(6);
		const { hit, seat } = PLACES.find((p) => p.front)!;
		expect(placeAt(hit[0] + 2, hit[1] + 2)).toBe(0);
		expect(placeAt(hit[0] + 2, hit[1] + 2, true)).toBe(seat);
	});

	it('has everyone do the same thing on every screen', () => {
		const kinds = new Set<string>();
		for (let sec = 0; sec < 20_000; sec += 50) {
			expect(idleOf('kim', sec, true)).toBe(idleOf('kim', sec, true));
			kinds.add(idleOf('kim', sec, true));
		}
		expect(kinds.size).toBeGreaterThan(4);
		expect(kinds.has('nod')).toBe(true);
	});
});
