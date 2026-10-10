import { describe, expect, it } from 'vitest';
import { recapEyebrow, recapTiles } from '$lib/ride/recap-frame';

describe('recapTiles (#3686)', () => {
	const full = {
		seconds: 3900,
		kj: 812,
		avgWatts: 208,
		normWatts: 221,
		execution: 0.94,
		xp: 959,
	};

	it("is the ride page's six, in the ride page's order", () => {
		expect(recapTiles(full)).toEqual([
			{ label: 'duration', value: '65:00' },
			{ label: 'work', value: '812', unit: 'kJ' },
			{ label: 'average', value: '208', unit: 'W' },
			{ label: 'normalised', value: '221', unit: 'W' },
			{ label: 'execution', value: '94', unit: '%' },
			{ label: 'earned', value: '959', unit: 'XP' },
		]);
	});

	it('drops a tile the ride has no answer for, and never shows 0', () => {
		const tiles = recapTiles({
			seconds: 40,
			kj: 0,
			avgWatts: 0,
			normWatts: undefined,
			execution: undefined,
			xp: undefined,
		});
		expect(tiles.map((tile) => tile.label)).toEqual(['duration']);
		expect(tiles.some((tile) => tile.value === '0')).toBe(false);
	});

	it('keeps an execution of zero: nothing on target is still an answer', () => {
		const labels = recapTiles({ ...full, execution: 0 }).map((t) => t.label);
		expect(labels).toContain('execution');
	});
});

describe('recapEyebrow (#3686)', () => {
	const saturday = new Date(2026, 9, 3, 18, 0);
	const weekday = saturday.toLocaleDateString(undefined, { weekday: 'long' });

	it('says Solo on a ride alone', () => {
		expect(recapEyebrow(saturday, 'Workout')).toBe(
			`${weekday} · Workout · Solo`,
		);
	});

	it('names the crew a session rode with', () => {
		expect(recapEyebrow(saturday, 'Bunch ride', 'Hill Rats')).toBe(
			`${weekday} · Bunch ride · Hill Rats`,
		);
	});
});
