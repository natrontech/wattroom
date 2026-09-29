import { describe, expect, it } from 'vitest';
import type { GripName } from './bikes/fit';
import { FRAMES, type FrameId } from './bikes/presets';
import { buildFigure, type Figure } from './figure';
import { resolveKit } from './kit';
import { pose } from './pose';
import { cleatGaps, finite, kneeFlexion, tyreGaps, wristGaps } from './qa';

// The gates #3072 names, measured on the pose itself (#3071).
const frames = Object.keys(FRAMES) as FrameId[];
const riders = frames.flatMap((id) =>
	[1.6, 1.95].map((height) => ({
		id,
		height,
		m: buildFigure(resolveKit(id), { lod: 1, body: { height } }),
	})),
);
const cranks = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);
const grips = (m: Figure) =>
	Object.keys(m.userData.rig.fit.grips) as GripName[];
const worst = (xs: number[]) => Math.max(...xs);

describe('the pose solver', () => {
	it('keeps every cleat within 5 mm of its spindle and every hand within 3 mm of its grip (G1, G7)', () => {
		let cleat = 0;
		let wrist = 0;
		for (const { m } of riders)
			for (const g of grips(m))
				for (const stand of [0, 1])
					for (const crank of cranks) {
						const grip = { R: { a: g, b: g, p: 1 }, L: { a: g, b: g, p: 1 } };
						pose(m, {
							crank,
							stand,
							grip,
							swayAmp: stand * 0.15,
							rockAmp: 0.03,
						});
						cleat = Math.max(cleat, worst(cleatGaps(m)));
						wrist = Math.max(wrist, worst(wristGaps(m)));
					}
		expect(cleat).toBeLessThan(0.005);
		expect(wrist).toBeLessThan(0.003);
	});

	it('bends the seated knee 25–42° at bottom dead centre (G4)', () => {
		for (const { id, height, m } of riders) {
			pose(m, { crank: Math.PI / 2 }); // the right crank straight down
			const flex = kneeFlexion(m);
			expect(flex, `${id} ${height} m`).toBeGreaterThanOrEqual(25);
			expect(flex, `${id} ${height} m`).toBeLessThanOrEqual(42);
		}
	});

	// ponytail: the bike does not pitch as the fork turns, so past a steer of
	// about 0.25 rad (a 4 m radius) the trail moves the front tyre 5 mm off
	// the road; pitch the frame with the steer when a hairpin that tight comes
	// into view.
	it('keeps both tyres within 5 mm of the road through a turn, standing, on a slope (G9)', () => {
		// A 5 m hairpin at 4 m/s and a 30 m bend at 12 m/s, both ways: lean and steer as the animator sets them.
		const turns = [
			[4, 5],
			[12, 30],
		].flatMap(([v, r]) =>
			[1, -1].map((sign) => ({
				lean: sign * Math.min(Math.atan((v * v) / (9.81 * r)), 0.49),
				steer: sign * Math.atan(1 / r),
			})),
		);
		let gap = 0;
		for (const { m } of riders)
			for (const pitch of [-0.15, 0, 0.12])
				for (const turn of turns)
					for (const crank of cranks) {
						pose(m, { crank, pitch, ...turn, swayAmp: 0.15, stand: 1 });
						gap = Math.max(gap, worst(tyreGaps(m)));
					}
		expect(gap).toBeLessThan(0.005);
	});

	it('still takes model.js’s call shape (G21) and never writes a NaN (G14)', () => {
		const m = riders[0].m;
		pose(m, {
			crank: 1,
			wheel: 2,
			stand: 0.5,
			rock: 0.1,
			rockBody: 0.02,
			nod: 0.01,
		});
		expect(finite(m)).toBe(true);
		expect(worst(cleatGaps(m))).toBeLessThan(0.005);
		pose(m, {
			crank: NaN,
			wheel: Infinity,
			stand: NaN,
			lean: NaN,
			elbow: NaN,
			grip: { R: { a: 'nope' as GripName, b: 'drops', p: NaN } },
		});
		expect(finite(m)).toBe(true);
		pose(m);
		expect(finite(m)).toBe(true);
	});
});
