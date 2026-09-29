import { describe, expect, it } from 'vitest';
import { createRideGrade, ergByRoad, feltGrade } from './ride-grade';
import { gradedRoad, stretch } from './road.test-helper';

describe('the felt grade (docs/SPEC.md "Route rides")', () => {
	it.each([
		[8, 0.5, 4],
		// SPEC: at the default difficulty a −6 % descent feels −1.5 %.
		[-6, 0.5, -1.5],
		[8, 1, 8],
		[-6, 1, -3],
		[40, 1, 15], // MaxTrainerGrade, ADR-0062's one ceiling
		[-30, 1, -5], // the felt floor
	])('a %s %% road at difficulty %s feels %s %%', (road, difficulty, felt) => {
		expect(feltGrade(road, difficulty)).toBeCloseTo(felt, 9);
	});
});

describe('rideGrade()', () => {
	const road = gradedRoad([...stretch(0, 500), ...stretch(8, 1000)]);

	it('reads the road a second ahead of the rider, at the dot’s speed', () => {
		// 10 m short of the climb: standing still it is flat, at 10 m/s it is not.
		expect(createRideGrade().at(road, 490, 0)).toBe(0);
		expect(createRideGrade().at(road, 490, 10)).toBeCloseTo(4, 9);
	});

	it('moves the felt grade at most 1 % a second', () => {
		const grade = createRideGrade();
		const felt = [grade.at(road, 400, 0)];
		for (let s = 0; s < 6; s++) felt.push(grade.at(road, 600, 0));
		expect(felt).toEqual([0, 1, 2, 3, 4, 4, 4]);
	});

	it('starts a new road where it stands', () => {
		const grade = createRideGrade();
		grade.at(road, 400, 0);
		grade.reset();
		expect(grade.at(road, 600, 0)).toBeCloseTo(4, 9);
	});
});

describe('ERG-by-road for one gear', () => {
	it.each([
		[0, 1, 150], // 0.60 × FTP on the flat
		[5, 1, 188], // 0.75
		[10, 1, 225], // capped at 0.90
		[-1, 1, 143], // 0.57
		[-3, 1, 125], // 0.50 on descents steeper than −2 %
		[0, 1.1, 165], // ± bias
	])('a %s %% road at bias %s holds %s W at FTP 250', (road, bias, watts) => {
		expect(ergByRoad(250, road, bias)).toBe(watts);
	});
});
