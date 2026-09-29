import { describe, expect, it } from 'vitest';
import { RiderAnimator, cadenceTarget, type RideInput } from './animator';
import { FRAMES, type FrameId } from './bikes/presets';
import { B } from './contract';
import { buildFigure } from './figure';
import { resolveKit } from './kit';
import { pose } from './pose';
import { cleatGaps, finite, wristGaps } from './qa';

const DT = 1 / 60;
const DEG_IN = 180 / Math.PI;
const figure = (id?: Parameters<typeof resolveKit>[0]) =>
	buildFigure(resolveKit(id), { lod: 1 });

/** A seeded wobble, so a noisy ride is the same noisy ride every run. */
function noise(seed: number) {
	return () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32 - 0.5;
	};
}

/** A ride that spends time near every threshold: sprints, a climb, a descent, a stop. */
function ride(seconds: number, seed = 7): RideInput[] {
	const n = noise(seed);
	return Array.from({ length: Math.round(seconds / DT) }, (_, i) => {
		const t = i * DT;
		const leg = Math.floor(t / 20) % 6;
		// prettier-ignore
		const base = [
			{ power: 200, cadence: 90, speed: 9, grade: 0 },
			{ power: 390, cadence: 105, speed: 13, grade: 0, sprint: true }, // around the sprint's entry
			{ power: 210, cadence: 70, speed: 4, grade: 5 }, // around the climb's entry
			{ power: 0, cadence: 0, speed: 14, grade: -4 }, // around the tuck's entry
			{ power: 20, cadence: 5, speed: 0.4, grade: 0 }, // around a stop
			{ power: 150, speed: 8, grade: 0, curvature: 0.05 }, // no cadence from the trainer
		][leg];
		return {
			...base,
			ftp: 250,
			power: base.power * (1 + 0.3 * n()),
			cadence:
				base.cadence === undefined ? undefined : base.cadence * (1 + 0.2 * n()),
			speed: base.speed * (1 + 0.1 * n()),
			grade: base.grade + n(),
		};
	});
}

describe('the rider animator', () => {
	it('never turns the crank backwards, pedalling, coasting or stopping (G11)', () => {
		const a = new RiderAnimator(figure(), { seed: 3 });
		let last = a.state.crank;
		let back = 0;
		for (const inp of ride(240)) {
			const { crank } = a.update(DT, inp);
			back = Math.min(back, crank - last);
			last = crank;
		}
		expect(back).toBeGreaterThanOrEqual(0);
	});

	it('changes posture at most once a second, and starts or stops pedalling at most every 0.3 s, on data chattering at every threshold (G15)', () => {
		const a = new RiderAnimator(figure(), { seed: 5 });
		const flips: number[] = [];
		const pedals: number[] = [];
		let was = a.state.posture;
		let pedalling = a.state.pedalling;
		ride(480, 11).forEach((inp, i) => {
			const s = a.update(DT, inp);
			if (s.posture !== was) flips.push(i * DT);
			if (s.pedalling !== pedalling) pedals.push(i * DT);
			was = s.posture;
			pedalling = s.pedalling;
		});
		const closest = (ts: number[]) =>
			Math.min(...ts.slice(1).map((t, i) => t - ts[i]));
		expect(flips.length).toBeGreaterThan(10); // the ride does reach every posture
		expect(closest(flips)).toBeGreaterThanOrEqual(1 - 1e-9);
		expect(closest(pedals)).toBeGreaterThanOrEqual(0.3 - 1e-9);
	});

	it('plays the same ride the same way for the same seed (G16)', () => {
		const run = () => {
			const m = figure();
			const a = new RiderAnimator(m, { seed: 9 });
			const frames: number[] = [];
			for (const inp of ride(120)) {
				pose(m, a.update(DT, inp));
				frames.push(...m.skeleton.bones[B.head].matrix.elements);
			}
			return frames;
		};
		const first = run();
		expect(first).toEqual(run());
		// …and the ride does look around, so the seeded glances are part of what matched.
		const b = new RiderAnimator(figure(), { seed: 9 });
		expect(ride(120).some((inp) => b.update(DT, inp).headYaw! > 0.1)).toBe(
			true,
		);
	});

	it('keeps the feet on the pedals and the hands on the grips through the whole ride (G1, G7)', () => {
		for (const id of ['race', 'tt', 'ordonnanz'] as const) {
			const m = figure(id);
			const a = new RiderAnimator(m, { seed: 1 });
			let cleat = 0;
			let wrist = 0;
			for (const inp of ride(240)) {
				pose(m, a.update(DT, inp));
				cleat = Math.max(cleat, ...cleatGaps(m));
				wrist = Math.max(wrist, ...wristGaps(m));
			}
			expect(cleat, id).toBeLessThan(0.005);
			expect(wrist, id).toBeLessThan(0.003);
		}
	});

	it('never writes a NaN, whatever the data (G14)', () => {
		const m = figure();
		const a = new RiderAnimator(m);
		// prettier-ignore
		const junk: RideInput[] = [{ power: NaN, cadence: NaN, speed: NaN }, { power: Infinity, cadence: -5, grade: Infinity, curvature: NaN, ftp: 0 }, {}, { power: -100, speed: -3 }];
		for (let i = 0; i < 600; i++)
			pose(m, a.update(i % 7 ? DT : NaN, junk[i % junk.length]));
		expect(finite(m)).toBe(true);
		// The animator itself stays finite too, or the rider freezes where pose() swallows it.
		for (const v of Object.values(a.state))
			if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
	});

	it('coasts forward to a level crank within 1.2 s, or stops softly where it is when that is too far (SPEC)', () => {
		for (const rpm of [90, 25]) {
			const a = new RiderAnimator(figure());
			for (let i = 0; i < 120; i++)
				a.update(DT, { power: 200, cadence: rpm, speed: 9 });
			let t = 0;
			while (a.state.mode !== 'hold' && t < 3) {
				a.update(DT, { power: 0, speed: 9 });
				if (a.state.mode === 'settle') t += DT; // from the moment it stops pedalling, 0.3 s after the data does
			}
			expect(t, `${rpm} rpm`).toBeGreaterThan(0);
			expect(t, `${rpm} rpm`).toBeLessThanOrEqual(1.2);
			if (rpm === 90) {
				const off = a.state.crank % Math.PI;
				expect(Math.min(off, Math.PI - off)).toBeLessThan(0.02);
			}
		}
	});

	it('follows SPEC’s cadence tiers without a trainer cadence, and stops below 5 rpm and 20 W', () => {
		expect([100, 170, 210, 240].map((w) => cadenceTarget(NaN, w, 250))).toEqual(
			[80, 85, 90, 95],
		);
		expect(cadenceTarget(4, 19, 250)).toBe(0);
		expect(cadenceTarget(4, 20, 250)).toBe(80);
		expect(cadenceTarget(72, 0, 250)).toBe(72);
	});

	it('keeps crank and wheels moving under reduced motion, and drops the sway, rock, yaw, nod and looks', () => {
		const a = new RiderAnimator(figure(), { seed: 2, reducedMotion: true });
		let moved = 0;
		let wheel = 0;
		for (const inp of ride(240)) {
			const s = a.update(DT, inp);
			moved +=
				Math.abs(s.swayAmp!) +
				Math.abs(s.rockAmp!) +
				Math.abs(s.yawAmp!) +
				Math.abs(s.nodAmp!) +
				Math.abs(s.headYaw!);
			wheel = s.wheel;
		}
		expect(moved).toBe(0);
		expect(a.state.crank).toBeGreaterThan(100);
		expect(wheel).toBeGreaterThan(100);
	});

	it('stands up with the lead crank 20–60° past the top, and moves the second hand after the first', () => {
		const a = new RiderAnimator(figure(), { seed: 4 });
		let prev = a.state.stand!;
		let rose: number | null = null;
		let lag = 0;
		for (let i = 0; i < 600 && rose === null; i++) {
			const s = a.update(DT, {
				power: 500,
				cadence: 100,
				speed: 12,
				ftp: 250,
				sprint: true,
			});
			if (s.grip!.R!.p < 1 && s.grip!.L!.p === 0) lag++;
			if (prev === 0 && s.stand! > 0)
				rose =
					((((s.crank + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) *
					(180 / Math.PI);
			prev = s.stand!;
		}
		expect(rose).not.toBeNull();
		expect(rose!).toBeGreaterThanOrEqual(20);
		expect(rose!).toBeLessThanOrEqual(60 + 100 * (1 / 60) * 6); // the frame after the window opened
		expect(lag).toBeGreaterThan(0);
	});

	it('leans each bike no further than SPEC’s 16–22° pedalling and 32° coasting', () => {
		for (const id of Object.keys(FRAMES) as FrameId[]) {
			const { pedal, coast } = figure(id).userData.rig.leanMax;
			// The pedal's own clearance sets it, so SPEC's range is to the nearest degree.
			expect(Math.round(pedal * DEG_IN), id).toBeGreaterThanOrEqual(16);
			expect(Math.round(pedal * DEG_IN), id).toBeLessThanOrEqual(22);
			expect(coast * DEG_IN, id).toBeLessThanOrEqual(32);
		}
	});
});
