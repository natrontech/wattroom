import { describe, expect, it } from 'vitest';
import { createWheel, passes } from './wheel';

/** Shelter heard once a second from t = 0, as the tick brings it. */
function heard(shelters: number[]): boolean[] {
	const wheel = createWheel();
	return shelters.map((s, t) => wheel.hear(s, t));
}

describe('in the wheel or in the wind (#3265)', () => {
	it('goes into the wheel at 15 % held a second', () => {
		expect(heard([0.2, 0.2])).toEqual([false, true]);
		expect(heard([0.15, 0.15])).toEqual([false, true]);
		expect(heard([0.14, 0.14, 0.14])).toEqual([false, false, false]);
	});

	it('needs the second unbroken: a dip starts the count again', () => {
		expect(heard([0.2, 0.05, 0.2, 0.2])).toEqual([false, false, false, true]);
	});

	it('leaves below 10 % held a second and a half', () => {
		// In at t=1; below 10 % from t=2, so out at t=3.5 — the tick at t=4.
		expect(heard([0.3, 0.3, 0.05, 0.05, 0.05])).toEqual([
			false,
			true,
			true,
			true,
			false,
		]);
	});

	it('holds the wheel between 10 and 15 %, and through a short gap', () => {
		expect(heard([0.3, 0.3, 0.12, 0.12, 0.12])).toEqual([
			false,
			true,
			true,
			true,
			true,
		]);
		expect(heard([0.3, 0.3, 0.05, 0.3, 0.05, 0.3])).toEqual([
			false,
			true,
			true,
			true,
			true,
			true,
		]);
	});

	it('reads the clock, not the count of ticks: four a second near the line', () => {
		const wheel = createWheel();
		const at = [0, 0.25, 0.5, 0.75, 1];
		expect(at.map((t) => wheel.hear(0.3, t))).toEqual([
			false,
			false,
			false,
			false,
			true,
		]);
	});

	it('starts the next race in the wind', () => {
		const wheel = createWheel();
		wheel.hear(0.3, 0);
		expect(wheel.hear(0.3, 1)).toBe(true);
		wheel.reset();
		expect(wheel.hear(0.3, 2)).toBe(false);
	});
});

describe('a rider going by (#3265)', () => {
	it('hears who crossed you within a wheel’s reach, and on which side', () => {
		expect(
			passes({ gaps: { a: -2, b: 3 } }, { gaps: { a: 1, b: -1 } }),
		).toEqual([-1, 1]);
	});

	it('stays quiet for a pass too far off, a level start and someone new', () => {
		expect(passes({ gaps: { a: -20 } }, { gaps: { a: 8 } })).toEqual([]);
		expect(passes({ gaps: { a: 0 } }, { gaps: { a: 1 } })).toEqual([]);
		expect(passes({ gaps: {} }, { gaps: { a: 1 } })).toEqual([]);
		expect(passes({ gaps: { a: 2 } }, { gaps: { a: 3 } })).toEqual([]);
	});
});
