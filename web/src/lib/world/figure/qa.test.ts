import { describe, expect, it } from 'vitest';
import { RiderAnimator } from './animator';
import type { Build, GripName } from './bikes/fit';
import { FRAMES, type FrameId } from './bikes/presets';
import { B } from './contract';
import { buildFigure, type Figure } from './figure';
import { resolveKit } from './kit';
import { pose, type PoseState } from './pose';
import {
	cleatGaps,
	clearance,
	finite,
	joints,
	kneeFlexion,
	partGaps,
	pop,
	tyreGaps,
	wristGaps,
} from './qa';
import { DT, ride } from './ride.test-helper';

/**
 * The figure's gates (#3072), measured on the posed bones. The quick sweep
 * runs in the web job: every frame on a middle rider, the smallest and the
 * largest riders on three, and a noisy ride on three. WATTROOM_FIGURE_FULL=1
 * runs every frame × build × height, each through a whole ride (about 40 s).
 * G11, G15 and G16 are the animator's own (animator.test.ts); G13 is the
 * material's (material.test.ts).
 */

const FULL = process.env.WATTROOM_FIGURE_FULL === '1';
const frames = Object.keys(FRAMES) as FrameId[];
const builds: Build[] = ['slim', 'athletic', 'strong'];
type Rig = { id: FrameId; height: number; build: Build };
// prettier-ignore
const rigs: Rig[] = FULL
	? frames.flatMap((id) => builds.flatMap((build) => [1.5, 1.7, 1.9, 2.05].map((height) => ({ id, height, build }))))
	: [...frames.map((id) => ({ id, height: 1.8, build: 'athletic' as const })), { id: 'race', height: 1.5, build: 'slim' }, { id: 'tt', height: 2.05, build: 'strong' }, { id: 'ordonnanz', height: 2.05, build: 'strong' }];
// prettier-ignore
const riders: Rig[] = FULL ? rigs : [{ id: 'race', height: 2.05, build: 'strong' }, { id: 'tt', height: 1.5, build: 'slim' }, { id: 'ordonnanz', height: 1.8, build: 'athletic' }];
const name = (r: Rig) => `${r.id} ${r.height} m ${r.build}`;
const figure = (r: Rig) =>
	buildFigure(resolveKit(r.id), {
		lod: 1,
		body: { height: r.height, build: r.build },
	});
const cranks = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);
// A 5 m hairpin at 4 m/s and a 30 m bend at 12 m/s, both ways: lean and steer as the animator sets them.
const turns = [
	[4, 5],
	[12, 30],
].flatMap(([v, r]) =>
	[1, -1].map((s) => ({
		lean: s * Math.min(Math.atan((v * v) / (9.81 * r)), 0.49),
		steer: s * Math.atan(1 / r),
	})),
);
const worst = (xs: number[]) => Math.max(...xs);

/** The largest breach of every gate over a set of poses, in metres (degrees for G4). */
type Tally = {
	g1: number;
	g7: number;
	g8: number;
	g9: number;
	g10: number;
	g12: number;
	nan: boolean;
};
const tally = (): Tally => ({
	g1: 0,
	g7: 0,
	g8: 0,
	g9: 0,
	g10: Infinity,
	g12: 0,
	nan: false,
});
function measure(m: Figure, t: Tally, grip?: GripName, clear = true) {
	t.g1 = Math.max(t.g1, worst(cleatGaps(m)));
	t.g7 = Math.max(t.g7, worst(wristGaps(m)));
	t.g8 = Math.max(t.g8, worst(partGaps(m, grip)));
	t.g9 = Math.max(t.g9, worst(tyreGaps(m)));
	if (clear) {
		const c = clearance(m);
		t.g10 = Math.min(t.g10, c.frame, c.arms);
	}
	t.nan ||= !finite(m);
}
function expectGates(t: Tally, who: string) {
	expect(t.nan, `${who}: G14 no NaN`).toBe(false);
	expect(t.g1, `${who}: G1 cleat on the spindle`).toBeLessThan(0.005);
	expect(t.g7, `${who}: G7 hands on the grips`).toBeLessThan(0.003);
	expect(t.g8, `${who}: G8 parts where they belong`).toBeLessThan(0.001);
	expect(t.g9, `${who}: G9 tyres on the road`).toBeLessThan(0.005);
	expect(t.g10, `${who}: G10 clearances`).toBeGreaterThan(0);
}

describe(`the figure's gates, ${FULL ? 'every rig' : 'the quick sweep'} (#3072)`, () => {
	for (const r of rigs)
		it(`holds every static pose on the ${name(r)}`, () => {
			const m = figure(r);
			const t = tally();
			for (const g of Object.keys(m.userData.rig.fit.grips) as GripName[])
				for (const stand of g === 'extensions' ? [0] : [0, 1])
					// the hands leave the extensions to stand
					for (const crank of cranks) {
						const grip = { R: { a: g, b: g, p: 1 }, L: { a: g, b: g, p: 1 } };
						pose(m, {
							crank,
							stand,
							grip,
							swayAmp: stand * 0.15,
							rockAmp: 0.03,
						});
						measure(m, t, g);
					}
			for (const pitch of [-0.15, 0, 0.12])
				for (const turn of turns)
					for (const crank of cranks) {
						pose(m, { crank, pitch, ...turn, swayAmp: 0.15, stand: 1 });
						measure(m, t);
					}
			expectGates(t, name(r));
			pose(m, { crank: Math.PI / 2 }); // the right crank straight down
			const flex = kneeFlexion(m);
			expect(flex, `${name(r)}: G4 knee at BDC`).toBeGreaterThanOrEqual(25);
			expect(flex, `${name(r)}: G4 knee at BDC`).toBeLessThanOrEqual(42);
		});

	for (const r of riders)
		it(
			`holds through a noisy ride, with no pop, on the ${name(r)} (G12)`,
			{ timeout: 60_000 },
			() => {
				const m = figure(r);
				const a = new RiderAnimator(m, { seed: 1 });
				const t = tally();
				const last: number[][] = [];
				for (const [i, inp] of ride(FULL ? 240 : 120).entries()) {
					const st = a.update(DT, inp);
					pose(m, st);
					const { R, L } = st.grip!;
					measure(
						m,
						t,
						R!.p === 1 && L!.p === 1 && R!.b === L!.b ? R!.b : undefined,
						i % 3 === 0, // clearances at 20 Hz: a limb moves a few mm between samples
					);
					last.push(joints(m));
					if (last.length > 3) last.shift();
					if (last.length === 3)
						t.g12 = Math.max(t.g12, pop(last[0], last[1], last[2]));
				}
				expectGates(t, name(r));
				// A jump shows its whole size; a 107 rpm sprint at 9° of sway peaks near 15 mm.
				expect(t.g12, `${name(r)}: G12 no pop`).toBeLessThan(0.02);
			},
		);

	it('still takes model.js’s call shape (G21), and survives junk (G14)', () => {
		const m = figure(rigs[0]);
		const bones = (st: PoseState) => {
			pose(m, st);
			return m.skeleton.bones.map((b) => b.matrix.clone());
		};
		const legacy: PoseState = {
			crank: 1,
			wheel: 2,
			stand: 1,
			rock: 0.1,
			rockBody: 0.02,
			nod: 0,
		};
		const base = bones(legacy);
		expect(finite(m)).toBe(true);
		expect(worst(cleatGaps(m))).toBeLessThan(0.005);
		// Its rock sways a standing rider's bike, its rockBody rocks the pelvis, its nod nods.
		expect(
			bones({ ...legacy, rock: undefined })[B.bike].equals(base[B.bike]),
		).toBe(false);
		expect(
			bones({ ...legacy, rockBody: 0.06 })[B.pelvis].equals(base[B.pelvis]),
		).toBe(false);
		expect(bones({ ...legacy, nod: 0.1 })[B.head].equals(base[B.head])).toBe(
			false,
		);
		// prettier-ignore
		pose(m, { crank: NaN, wheel: Infinity, stand: NaN, lean: NaN, elbow: NaN, grip: { R: { a: 'nope' as GripName, b: 'drops', p: NaN } } });
		expect(finite(m)).toBe(true);
		pose(m);
		expect(finite(m)).toBe(true);
	});
});
