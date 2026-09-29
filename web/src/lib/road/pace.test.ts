import { describe, expect, it } from 'vitest';
import {
	BikeKg,
	PaceDefaultCdA,
	ReferenceRiderKg,
	ReferenceRiderWatts,
} from '$lib/protocol';
import { cornerLimit, createPace, steadySpeed } from './pace';
import { BEND_STEP, curvatureOf, golden } from './golden.test-helper';

const within = (got: number, want: number) =>
	Math.abs(got - want) <= 0.001 * Math.max(Math.abs(want), 1);

describe('the pace model agrees with its Go twin', () => {
	it('has vectors to agree on', () => {
		expect(golden.vectors.length).toBeGreaterThan(0);
	});

	for (const v of golden.vectors) {
		it(`${v.name} at CdA ${v.cda}`, () => {
			const pace = createPace(
				v.speed,
				v.bends && cornerLimit(curvatureOf(v.bends), BEND_STEP),
			);
			for (const leg of v.legs) {
				for (let s = 0; s < leg.seconds; s++)
					pace.step(leg.watts, leg.grade, v.mass, v.cda, leg.shelter);
				expect(
					within(pace.speed, leg.speed),
					`speed ${pace.speed} vs ${leg.speed}`,
				).toBe(true);
				expect(
					within(pace.distance, leg.distance),
					`distance ${pace.distance} vs ${leg.distance}`,
				).toBe(true);
			}
		});
	}
});

describe('step()', () => {
	it('takes exactly watts, grade, mass, CdA and shelter', () => {
		// By name, not arity (ADR-0084): a defaulted gear or trainer-speed
		// argument slips past a length check.
		const source = createPace().step.toString();
		const params = source
			.slice(source.indexOf('(') + 1, source.indexOf(')'))
			.split(',')
			.map((p) => p.split(/[:=]/)[0].trim())
			.filter(Boolean);
		expect(params).toEqual(['watts', 'grade', 'mass', 'cda', 'shelter']);
	});
});

describe('the reference rider (docs/SPEC.md)', () => {
	const mass = ReferenceRiderKg + BikeKg;
	const kmh = (grade: number, cda: number) =>
		steadySpeed(ReferenceRiderWatts, grade, mass, cda) * 3.6;

	it('rides 35.4 km/h on the flat and 11.2 km/h up 8 % at the default CdA', () => {
		expect(kmh(0, PaceDefaultCdA)).toBeCloseTo(35.4, 1);
		expect(kmh(8, PaceDefaultCdA)).toBeCloseTo(11.2, 1);
	});

	it('rides 33.0 km/h on the flat at CdA 0.40', () => {
		expect(kmh(0, 0.4)).toBeCloseTo(33.0, 1);
	});

	it('steps to the speed the balance gives', () => {
		const pace = createPace();
		for (let s = 0; s < 600; s++)
			pace.step(ReferenceRiderWatts, 0, mass, PaceDefaultCdA, 0);
		expect(pace.speed).toBeCloseTo(
			steadySpeed(ReferenceRiderWatts, 0, mass, PaceDefaultCdA),
			2,
		);
	});
});

describe('corners (#3204)', () => {
	const mass = ReferenceRiderKg + BikeKg;
	const hairpin = cornerLimit(
		curvatureOf([{ fromM: 200, toM: 200 + Math.PI * 10, radiusM: 10 }]),
		BEND_STEP,
	);

	it('says it is braking into a hairpin, and only then', () => {
		const pace = createPace(steadySpeed(0, -8, mass, PaceDefaultCdA), hairpin);
		const braked: number[] = [];
		for (let s = 0; s < 30; s++) {
			pace.step(0, -8, mass, PaceDefaultCdA, 0);
			if (pace.braking) braked.push(Math.round(pace.distance));
		}
		expect(braked.length).toBeGreaterThan(0);
		expect(Math.min(...braked)).toBeGreaterThan(200 - 40);
		expect(Math.max(...braked)).toBeLessThanOrEqual(240);
	});

	it('never brakes on a road that never bends', () => {
		const pace = createPace(3, cornerLimit(new Array(200).fill(0), BEND_STEP));
		for (let s = 0; s < 120; s++) {
			pace.step(400, -10, mass, PaceDefaultCdA, 0);
			expect(pace.braking).toBe(false);
		}
	});
});
