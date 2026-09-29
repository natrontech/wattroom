import { describe, expect, it } from 'vitest';
import { gradeAt, heightAt } from './at-metre';
import type { Road } from './road';

// server/internal/road/profile_test.go's road and table, so the ride's own
// metres and the server's replay read a road the same (#3027, ADR-0074):
// 2 km sampled every 20 m, up 2 % to 1 km, then down 1 %.
const upThenDown: Road = {
	length: 2000,
	heights: Array.from({ length: 101 }, (_, i) =>
		i <= 50 ? 100 + 0.4 * i : 120 - 0.2 * (i - 50),
	),
	turns: Array<number>(100).fill(0),
};

describe('a road read by distance, as the server reads it', () => {
	it.each([
		['height at the start', heightAt(upThenDown, 0), 100],
		['height between samples', heightAt(upThenDown, 10), 100.2],
		['height at the top', heightAt(upThenDown, 1000), 120],
		["height past the end is the end's", heightAt(upThenDown, 2500), 110],
		["height before the start is the start's", heightAt(upThenDown, -5), 100],
		['grade on the way up', gradeAt(upThenDown, 500), 2],
		['grade on the way down', gradeAt(upThenDown, 1500), -1],
		['grade at the very end', gradeAt(upThenDown, 2000), -1],
	])('%s', (_, got, want) => {
		expect(got).toBeCloseTo(want, 9);
	});
});
