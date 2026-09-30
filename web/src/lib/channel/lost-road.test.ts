import { describe, expect, it } from 'vitest';
import type { ServerTick } from '$lib/protocol';
import { referenceOnly, resumeKm, roadOf } from '$lib/channel/lost-road';

const tick = (coach: string, bunchM: number, loop = false): ServerTick =>
	({
		at: 0,
		state: {
			phase: 'running',
			coach,
			workoutName: 'Openers',
			totalSeconds: 3600,
			workoutJson: '{"steps":[]}',
			route: {
				id: 'r1',
				hash: 'h',
				genName: 'Road',
				fromM: 0,
				lengthM: 20_000,
				loop,
				reverse: true,
			},
		},
		world: { bunchM, speedMps: 8 },
	}) as unknown as ServerTick;

describe('roadOf', () => {
	it('keeps the route, its direction and the bunch’s metre for the coach', () => {
		expect(roadOf(tick('me', 14_200), 'me')).toEqual({
			workoutName: 'Openers',
			workoutJson: '{"steps":[]}',
			totalSeconds: 3600,
			route: { id: 'r1', fromM: 14_200, reverse: true, loop: false },
		});
		expect(resumeKm(roadOf(tick('me', 14_250), 'me')!)).toBe('14.3');
	});

	it('keeps nothing for someone else’s session, no road, or a road already ridden to its end', () => {
		expect(roadOf(tick('coach', 14_200), 'me')).toBeNull();
		expect(
			roadOf(
				{ at: 0, state: { phase: 'running', coach: 'me' } } as ServerTick,
				'me',
			),
		).toBeNull();
		expect(roadOf(tick('me', 20_000), 'me')).toBeNull();
		// A loop goes round again: its end is somewhere to resume.
		expect(roadOf(tick('me', 19_999.5, true), 'me')?.route.fromM).toBe(19_999);
	});
});

describe('referenceOnly', () => {
	it('drops the crew’s cut and keeps the reference', () => {
		const attached =
			'{"name":"R","road":{"routeId":"r1","fromM":10,"toM":900,"stepEndM":[500,900],"profile":"AAA","originM":400,"deleted":false},"steps":[]}';
		expect(JSON.parse(referenceOnly(attached))).toEqual({
			name: 'R',
			road: { routeId: 'r1', fromM: 10, toM: 900, stepEndM: [500, 900] },
			steps: [],
		});
	});

	it('leaves a workout with no road, or no JSON, as it was', () => {
		expect(referenceOnly('{"steps":[]}')).toBe('{"steps":[]}');
		expect(referenceOnly('not json')).toBe('not json');
	});
});
