import { describe, expect, it } from 'vitest';
import { parseSharedWorkout } from './shared';

describe('the shared workout', () => {
	it('keeps a game’s road though it has no steps to ride (#3114)', () => {
		const road = { routeId: 'r', fromM: 0, toM: 2200, profile: 'cut' };
		const game = JSON.stringify({
			name: 'Backyard Ramp',
			unscored: true,
			road,
			steps: [],
		});
		expect(parseSharedWorkout(game)).toEqual({
			workout: { name: 'Backyard Ramp', steps: [], road },
			segments: [],
		});
		// A game off a road, or anything else that is not a workout, is still nothing.
		const bare = JSON.stringify({
			name: 'Backyard Ramp',
			unscored: true,
			steps: [],
		});
		expect(parseSharedWorkout(bare)).toEqual({ workout: null, segments: [] });
		expect(parseSharedWorkout('{"road":{}}')).toEqual({
			workout: null,
			segments: [],
		});
	});
});
