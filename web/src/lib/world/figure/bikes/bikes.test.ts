import { describe, expect, it } from 'vitest';
import {
	BUILDS,
	FIT_KNEE_DEG,
	fitRider,
	HEIGHT_M,
	kneeReach,
	riderDims,
	STAND_KNEE_DEG,
	toeDown,
	type Build,
	type RiderDims,
} from './fit';
import { bikeGeometry, wheelRadius, type Pt } from './geometry';
import { FRAMES, type FrameId } from './presets';

const DEG = Math.PI / 180;
const ids = Object.keys(FRAMES) as FrameId[];

describe('frames from real geometry', () => {
	it('offers the nine presets', () => {
		expect(ids).toHaveLength(9);
		expect(FRAMES.race.geometry).toMatchObject({
			stack: 565,
			reach: 395,
			hta: 73.5,
			sta: 73.5,
			chainstay: 410,
			bbDrop: 72,
			forkOffset: 44.4,
		});
	});

	it('puts the tyre on a 622 bead seat: R = 0.311 + 0.95 × width', () => {
		expect(wheelRadius(25)).toBeCloseTo(0.311 + 0.95 * 0.025, 12);
		expect(bikeGeometry(FRAMES.gravel.geometry, 45).R).toBeCloseTo(
			0.311 + 0.95 * 0.045,
			12,
		);
	});

	// Gate G20: what was built reads back as what was specified.
	for (const id of ids)
		for (const size of [1, 1.1])
			it(`G20: ${id} at size ${size} reproduces stack, reach, head angle and offset`, () => {
				const g = FRAMES[id].geometry;
				const bk = bikeGeometry(g, 28, size);
				expect((bk.htTop.y - bk.bb.y) / size).toBeCloseTo(g.stack / 1000, 12);
				expect((bk.htTop.x - bk.bb.x) / size).toBeCloseTo(g.reach / 1000, 12);
				expect(Math.atan2(-bk.down.y, bk.down.x) / DEG).toBeCloseTo(g.hta, 10);
				// The axle's distance from the steering axis, square to it.
				const offset =
					(bk.front.x - bk.htTop.x) * bk.down.y -
					(bk.front.y - bk.htTop.y) * bk.down.x;
				expect(Math.abs(offset)).toBeCloseTo(g.forkOffset / 1000, 12);
				expect(bk.front.y).toBe(bk.R);
				expect(
					Math.hypot(bk.rear.x - bk.bb.x, bk.rear.y - bk.bb.y),
				).toBeCloseTo(g.chainstay / 1000, 12);
			});
});

/** The knee's flexion from straight, degrees, for a hip and an ankle. */
function flexion(d: RiderDims, hip: Pt, ankle: Pt): number {
	const dd = (hip.x - ankle.x) ** 2 + (hip.y - ankle.y) ** 2;
	return (
		Math.acos((dd - d.thigh ** 2 - d.shin ** 2) / (2 * d.thigh * d.shin)) / DEG
	);
}

/** Where the ankle is with the crank at `a` (0 forward, π/2 bottom dead centre) and the foot toed down `toe`. */
function ankleAt(
	d: RiderDims,
	bb: Pt,
	crank: number,
	a: number,
	toe: number,
): Pt {
	const c = Math.cos(-toe);
	const s = Math.sin(-toe);
	return {
		x: bb.x + crank * Math.cos(a) - (d.cleat.x * c - d.cleat.y * s),
		y: bb.y - crank * Math.sin(a) - (d.cleat.x * s + d.cleat.y * c),
	};
}

describe('the fit solver', () => {
	const heights = [HEIGHT_M.min, HEIGHT_M.default, HEIGHT_M.max];
	const builds = Object.keys(BUILDS) as Build[];

	for (const id of ids)
		it(`sets ${FIT_KNEE_DEG}° of knee flexion at bottom dead centre on the ${id}`, () => {
			for (const h of heights)
				for (const b of builds) {
					const d = riderDims(h, b);
					const bk = bikeGeometry(FRAMES[id].geometry, 28, d.k);
					const fit = fitRider(d, bk, FRAMES[id].cockpit);
					const bdc = ankleAt(
						d,
						bk.bb,
						fit.crank,
						Math.PI / 2,
						toeDown(Math.PI),
					);
					expect(flexion(d, fit.hipSeat, bdc)).toBeCloseTo(FIT_KNEE_DEG, 6);
					expect(fit.spacer).toBeGreaterThanOrEqual(
						FRAMES[id].cockpit.spacer[0],
					);
					expect(fit.spacer).toBeLessThanOrEqual(FRAMES[id].cockpit.spacer[1]);
					expect(fit.stem).toBeGreaterThanOrEqual(FRAMES[id].cockpit.stem[0]);
					expect(fit.stem).toBeLessThanOrEqual(FRAMES[id].cockpit.stem[1]);
				}
		});

	it('stands forward, and never straighter than 20° at the knee over a revolution', () => {
		for (const id of ids) {
			const d = riderDims();
			const bk = bikeGeometry(FRAMES[id].geometry, 28);
			const fit = fitRider(d, bk, FRAMES[id].cockpit);
			expect(fit.hipStand.x).toBeGreaterThan(fit.hipSeat.x);
			for (let i = 0; i < 72; i++) {
				const a = (i / 72) * 2 * Math.PI;
				const ankle = ankleAt(
					d,
					bk.bb,
					fit.crank,
					a,
					toeDown(a + Math.PI / 2) + 8 * DEG,
				);
				const dist = Math.hypot(
					fit.hipStand.x - ankle.x,
					fit.hipStand.y - ankle.y,
				);
				expect(dist).toBeLessThanOrEqual(kneeReach(d, STAND_KNEE_DEG) + 1e-9);
			}
		}
	});

	it('names the grips each bar offers, the left hand mirroring the right', () => {
		const grips = (id: FrameId) => {
			const d = riderDims();
			return fitRider(
				d,
				bikeGeometry(FRAMES[id].geometry, 28),
				FRAMES[id].cockpit,
			).grips;
		};
		expect(Object.keys(grips('race')).sort()).toEqual([
			'drops',
			'hoods',
			'tops',
		]);
		expect(Object.keys(grips('tt')).sort()).toEqual([
			'extensions',
			'hoods',
			'tops',
		]);
		expect(Object.keys(grips('ordonnanz'))).toEqual(['hoods']);
		const hoods = grips('race').hoods!;
		expect(hoods.L.p).toEqual([hoods.R.p[0], hoods.R.p[1], -hoods.R.p[2]]);
	});

	it('keeps a figure to the heights ADR-0073 offers', () => {
		expect(riderDims(1.2).height).toBe(HEIGHT_M.min);
		expect(riderDims(2.4).height).toBe(HEIGHT_M.max);
		expect(riderDims(Number.NaN).height).toBe(HEIGHT_M.default);
	});
});
