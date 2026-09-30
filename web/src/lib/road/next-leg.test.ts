import { describe, expect, it } from 'vitest';
import type { LostRoad } from '$lib/channel/lost-road';
import { nextLeg, nextLegAt } from './next-leg';
import { crewFromM, ownerFromM } from './ride-together';
import type { Road } from './road';

// A flat 3 km road sampled every 20 m: the crew's cut starts 400 m in.
const flat: Road = {
	length: 3000,
	heights: Array(151).fill(0),
	turns: Array(150).fill(0),
};
const route = {
	id: 'r1',
	genName: 'Road · 3.0 km · 0 m',
	road: flat,
	climbs: [],
};
const ended = (workoutJson: string, crewM: number): LostRoad => ({
	workoutName: 'Openers',
	workoutJson,
	totalSeconds: 600,
	route: { id: 'r1', fromM: crewM },
	startedAt: Date.UTC(2026, 8, 29, 17, 0),
});

describe('ownerFromM', () => {
	it('puts the crew’s metre back on the owner’s road', () => {
		expect(ownerFromM(flat, 600)).toBe(1000);
		expect(crewFromM(flat, ownerFromM(flat, 600))).toBe(600);
	});
});

describe('nextLeg', () => {
	it('rides any workout on the road again from where the bunch stopped', () => {
		const rode = JSON.stringify({
			name: 'Openers',
			road: { routeId: 'r1', fromM: 0, toM: 3000 },
			steps: [{ type: 'steady', seconds: 600, target: 0.7 }],
		});
		const leg = nextLeg(ended(rode, 600), route)!;
		expect(leg.road).toEqual({ routeId: 'r1', fromM: 1000, toM: 3000 });
		expect(leg.steps).toEqual([{ type: 'steady', seconds: 600, target: 0.7 }]);
	});

	it('goes on with a road’s own workout from there', () => {
		const rode = JSON.stringify({
			name: 'Road',
			road: { routeId: 'r1', fromM: 0, toM: 3000, stepEndM: [3000] },
			steps: [{ type: 'steady', seconds: 400, target: 0.7 }],
		});
		const leg = nextLeg(ended(rode, 600), route)!;
		expect(leg.road?.fromM).toBe(1000);
		expect(leg.road?.stepEndM?.at(-1)).toBe(3000);
	});

	it('has no next leg at the road’s end', () => {
		const rode = JSON.stringify({ name: 'Openers', steps: [] });
		expect(nextLeg(ended(rode, 2600), route)).toBeNull();
	});

	it('is planned a week on, at the time the session started', () => {
		expect(nextLegAt(ended('{}', 0)).toISOString()).toBe(
			'2026-10-06T17:00:00.000Z',
		);
	});
});
