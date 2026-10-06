import { describe, expect, it } from 'vitest';
import type { RaceRider, ServerTick } from '$lib/protocol';
import { ordinal, raceOf } from './race-view';

const KLAXON = 100_000;

function tick(
	at: number,
	racers: Record<string, RaceRider>,
	race: Partial<NonNullable<NonNullable<ServerTick['game']>['race']>> = {},
) {
	return {
		at,
		state: { phase: 'running', elapsed: 0, route: { lengthM: 6000 } },
		game: { race: { flagAtMs: 0, klaxonAtMs: KLAXON, ...race } },
		world: { bunchM: 0, speedMps: 0, racers },
		roster: [],
		riders: {},
	} as unknown as ServerTick;
}

describe('your race on the RACE page (#3174)', () => {
	it('places you among your own Category only, the line first', () => {
		const race = raceOf(
			tick(KLAXON + 60_000, {
				you: { m: 2000, v: 9, cat: 'C', par: 12.4 },
				fast: { m: 2600, v: 9, cat: 'C' },
				done: { m: 6000, v: 0, cat: 'C', finishMs: 150_000 },
				slow: { m: 1500, v: 8, cat: 'C' },
				other: { m: 5000, v: 11, cat: 'A' },
			}),
			'you',
		)!;
		expect(race).toMatchObject({
			phase: 'racing',
			par: 12.4,
			category: 'C',
			place: 3,
			of: 4,
			toLine: 4000,
		});
	});

	it('has no par before km 0, and reads an absent par after it as on par', () => {
		const at = (t: number) =>
			raceOf(
				tick(t, { you: { m: 0, v: 8, cat: 'D' }, b: { m: 0, v: 8, cat: 'D' } }),
				'you',
			)!;
		expect(at(KLAXON - 1000)).toMatchObject({ phase: 'neutral', par: null });
		expect(at(KLAXON + 1000)).toMatchObject({ phase: 'racing', par: 0 });
	});

	it('knows a held race, a finished one, and a Wheelrace’s line', () => {
		const you = { m: 3000, v: 9, cat: 'B' };
		expect(
			raceOf(tick(KLAXON + 5000, { you }, { neutralised: true }), 'you')!.phase,
		).toBe('held');
		expect(
			raceOf(tick(KLAXON + 5000, { you }, { lineM: 4200 }), 'you')!.toLine,
		).toBe(1200);
		expect(
			raceOf(
				tick(KLAXON + 5000, { you: { ...you, finishMs: KLAXON + 4000 } }),
				'you',
			),
		).toMatchObject({ phase: 'finished', toLine: 0 });
	});

	it('is nothing for a rider not racing, or a race that never started', () => {
		const racers = { a: { m: 0, v: 0, cat: 'C' } };
		expect(raceOf(tick(KLAXON, racers), 'you')).toBeNull();
		expect(raceOf(tick(KLAXON, racers, { void: 'too_few' }), 'a')).toBeNull();
	});

	it('writes places as a rider says them', () => {
		expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
			'1st',
			'2nd',
			'3rd',
			'4th',
			'11th',
			'12th',
			'13th',
			'21st',
			'22nd',
			'101st',
		]);
	});
});
