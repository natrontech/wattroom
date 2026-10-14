import { expect, test } from 'vitest';
import { INTRO_ROAD_ID, loadRoad } from './roads';

test('the intro road loads with no account, and is not saved against', async () => {
	const result = await loadRoad(INTRO_ROAD_ID);
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.route.borrowed).toBe(true);
	expect(result.route.road.length).toBeGreaterThan(5000);
});
