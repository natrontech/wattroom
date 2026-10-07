import { describe, expect, it } from 'vitest';
import type { ServerTick } from '$lib/protocol';
import { bunchOf } from './bunch-view';
import { levelFromXp } from '$lib/level';
import type { LiveRider } from './types';

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

	it('names who this tick’s cheers are for, and nobody for a cheer to everyone (#3116)', () => {
		const t = tick({ bunchM: 0, speedMps: 0 });
		t.cheers = [
			{ emoji: 'thumbs-up', from: 'Kim', to: 'a' },
			{ emoji: 'flame', from: 'Tom' },
		];
		expect(bunchOf(t, [])!.cheered).toEqual(['a']);
	});

	it('carries each rider’s name, level and voice for their tag, and a hidden meter (#3086)', () => {
		const t = tick({ bunchM: 0, speedMps: 0 }, true);
		t.roster = [{ id: 'a', totalXp: 5000 }] as ServerTick['roster'];
		t.game = { meterHidden: true } as ServerTick['game'];
		const riders = [
			{ id: 'a', name: 'Ana', watts: 200, ftp: 250, speaking: true },
		] as unknown as LiveRider[];
		const view = bunchOf(t, riders)!;
		expect(view.present.get('a')).toMatchObject({
			name: 'Ana',
			level: levelFromXp(5000),
			speaking: true,
		});
		expect(view.meterHidden).toBe(true);
	});

	it('says when a game rides, where the team car never runs', () => {
		expect(bunchOf(tick({ bunchM: 0, speedMps: 0 }, true), [])!.game).toBe(
			true,
		);
	});
});
