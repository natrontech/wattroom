import { describe, expect, it } from 'vitest';
import type { ServerTick } from '$lib/protocol';
import { bunchOf } from './bunch-view';

const tick = (world: ServerTick['world'], game = false) =>
	({
		at: 0,
		state: {
			phase: 'running',
			id: 's',
			coach: 'a',
			elapsed: 130,
			route: { lengthM: 5000 },
		},
		world,
		roster: [{ id: 'a' }],
		riders: {},
		game: game ? {} : undefined,
	}) as unknown as ServerTick;

describe('the bunch as the world reads it (#3098)', () => {
	it('unrolls a looped road’s laps and turns decimetres into metres', () => {
		const view = bunchOf(
			tick({
				bunchM: 120,
				speedMps: 8,
				lap: 2,
				offsets: { a: -35 },
				order: ['a', 'b'],
			}),
			[],
		)!;
		expect(view.m).toBe(10_120);
		expect(view.offsets).toEqual({ a: -3.5 });
		expect(view.order).toEqual(['a', 'b']);
		expect(view.coach).toBe('a');
		expect(view.elapsed).toBe(130);
	});

	it('rides no shared bunch in a race, nor off a road', () => {
		expect(
			bunchOf(
				tick({ bunchM: 0, speedMps: 0, racers: { a: { m: 10, v: 8 } } }),
				[],
			),
		).toBeNull();
		expect(bunchOf(tick(undefined), [])).toBeNull();
	});

	it('says when a game rides, where the team car never runs', () => {
		expect(bunchOf(tick({ bunchM: 0, speedMps: 0 }, true), [])!.game).toBe(
			true,
		);
	});
});
