import { describe, expect, it } from 'vitest';
import { shiftAnswer } from './easier-harder';

const ride = (sim: boolean, label = 'Gear 15', end: 1 | -1 | 0 = 0) => ({
	sim,
	gear: { label },
	atEnd: (dir: 1 | -1) => dir === end,
});

describe('what a phone tap moved (#3334)', () => {
	it('is the gear in SIM, with its end either way', () => {
		expect(shiftAnswer(ride(true), { bias: 1 })).toEqual({
			label: 'Gear 15',
			atEnd: false,
		});
		expect(shiftAnswer(ride(true, 'Gear 24', 1), null)).toEqual({
			label: 'Gear 24',
			atEnd: true,
		});
		expect(shiftAnswer(ride(true, '−4', -1), null)?.atEnd).toBe(true);
	});

	it('is the workout’s bias in ERG, at an end at 80 % and 120 %', () => {
		expect(shiftAnswer(ride(false), { bias: 1.03 })).toEqual({
			label: 'Bias 103%',
			atEnd: false,
		});
		expect(shiftAnswer(ride(false), { bias: 1.2 })?.atEnd).toBe(true);
		expect(shiftAnswer(ride(false), { bias: 0.8 })?.atEnd).toBe(true);
	});

	it('is the free ride’s watts in ERG, at an end at its bounds', () => {
		expect(shiftAnswer(ride(false), { watts: 210 })).toEqual({
			label: '210 W',
			atEnd: false,
		});
		expect(shiftAnswer(ride(false), { watts: 50 })?.atEnd).toBe(true);
		expect(shiftAnswer(ride(false), { watts: 1000 })?.atEnd).toBe(true);
	});

	it('is nothing in ERG when the ride sets the watts', () => {
		expect(shiftAnswer(ride(false), null)).toBeNull();
	});
});
