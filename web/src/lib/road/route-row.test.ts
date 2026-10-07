import { describe, expect, it } from 'vitest';
import type { Climb } from './climbs';
import { backLink, classChips, riddenLine, statLine } from './route-row';

const climb = (cls: Climb['cls']): Climb =>
	({ startM: 0, topM: 1000, gainM: 50, cls }) as Climb;

describe('a route row (#3683)', () => {
	it('names each class once, hardest first', () => {
		expect(
			classChips([climb('IV'), climb('II'), climb(null), climb('IV')]),
		).toEqual(['II', 'IV']);
		expect(classChips([climb('HC'), climb('I')])).toEqual(['HC', 'I']);
		expect(classChips([])).toEqual([]);
	});

	it('reads km, metres climbed and its classed climbs', () => {
		const road = { lengthM: 7100, gainM: 571 };
		expect(statLine({ ...road, climbs: [climb('II')] })).toBe(
			'7.1 km · 571 m · 1 climb',
		);
		expect(statLine({ ...road, climbs: [climb('IV'), climb('IV')] })).toBe(
			'7.1 km · 571 m · 2 climbs',
		);
		expect(statLine({ ...road, climbs: [climb(null)] })).toBe('7.1 km · 571 m');
	});

	it('says where you left off before how often you rode it', () => {
		expect(riddenLine({})).toBe('Not ridden yet');
		expect(riddenLine({ rides: 0 })).toBe('Not ridden yet');
		expect(
			riddenLine({ rides: 3, lastRiddenAt: '2026-09-29T18:00:00Z' }),
		).toMatch(/^Ridden 3× · last /);
		expect(
			riddenLine({
				rides: 3,
				lastRiddenAt: '2026-09-29T18:00:00Z',
				carryOnM: 21300,
			}),
		).toBe('Left off at km 21.3');
	});
});

describe("the route page's back link (Flows rule 4)", () => {
	it('returns to the picker it was opened from', () => {
		expect(backLink('/ride')).toEqual({ href: '/ride', label: 'Ride' });
		expect(backLink('/crew/c1/v/v1')).toEqual({
			href: '/crew/c1/v/v1',
			label: 'Back',
		});
	});

	it('falls back to Workouts, and never leaves the site', () => {
		const home = { href: '/workouts', label: 'Workouts' };
		for (const back of [
			null,
			'',
			'ride',
			'//evil.example',
			'https://evil.example',
			'/\\evil.example',
		])
			expect(backLink(back), String(back)).toEqual(home);
	});
});
