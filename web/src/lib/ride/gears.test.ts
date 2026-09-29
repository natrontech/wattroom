import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSimulation, FtmsTrainer } from '$lib/ble/ftms';
import { FakeDevice } from '$lib/ble/fake-gatt.test-helper';
import { SimulatedTrainer } from '$lib/ble/simulated';
import type {
	SimParams,
	Trainer,
	TrainerSample,
	TrainerStatus,
} from '$lib/ble/trainer';
import { BikeKg, PaceDefaultCdA, ReferenceRiderKg } from '$lib/protocol';
import { at } from '$lib/road/along';
import { createPace, dotSecond } from '$lib/road/pace';
import { composeSim, createActuator } from './actuation.svelte';
import { createRideGrade } from './ride-grade';
import { gradedRoad, stretch } from './road.test-helper';

/** A trainer already in SIM, that keeps what it is told. */
class Recorder implements Trainer {
	name = 'recorder';
	status: TrainerStatus = 'connected';
	mode: 'erg' | 'sim' = 'sim';
	roads: Required<SimParams>[] = [];
	async connect() {}
	async disconnect() {}
	async setTargetPower() {
		this.mode = 'erg';
	}
	async setSimulation(road: SimParams) {
		this.mode = 'sim';
		this.roads.push(road as Required<SimParams>);
	}
	onSample(_: (s: TrainerSample) => void) {
		return () => {};
	}
	onStatus(_: (s: TrainerStatus) => void) {
		return () => {};
	}
}

/** A seeded uniform [0, 1). */
function seeded(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const bytes = (road: SimParams) =>
	Array.from(new Uint8Array(encodeSimulation(road))).join();
const FLAT = bytes({ gradePct: 0 });

describe('felt against road (ADR-0084)', () => {
	it('writes the free ride’s 8 % as 8 %, a sprint’s 5 % as 5 % and a road’s 8 % as 4 %', () => {
		const grade = (write: (act: ReturnType<typeof createActuator>) => void) => {
			const trainer = new Recorder();
			write(createActuator(() => trainer));
			return Math.round(trainer.roads.at(-1)!.gradePct * 100) / 100;
		};
		expect(grade((act) => act.grade(8))).toBe(8);
		expect(
			grade((act) => act.sprint({ grade: 5, singleSpeed: false }, 250)),
		).toBe(5);
		const road = gradedRoad(stretch(8, 1000));
		expect(grade((act) => act.road(createRideGrade().at(road, 100, 0)))).toBe(
			4,
		);
	});

	it('carries no shelter in Cw with "Feel the draft" off', () => {
		expect(composeSim({ feltPct: 3 }, 0.35, 1, false).road.cw).toBeCloseTo(
			0.51,
			9,
		);
		expect(composeSim({ feltPct: 3 }, 0.35, 1, true).road.cw).toBeCloseTo(
			0.51 * 0.65,
			9,
		);
	});

	it('starts the gear again at k = 1 when the grant comes back, and says so', () => {
		const trainer = new Recorder();
		const resets: number[] = [];
		const act = createActuator(
			() => trainer,
			() => resets.push(1),
		);
		act.grade(3);
		act.shift(1);
		act.shift(1);
		expect(act.gear.k).toBeGreaterThan(1);
		act.grant(false); // another screen takes the trainer
		expect(act.gear.k).toBeGreaterThan(1);
		act.grant(true);
		expect(act.gear.k).toBe(1);
		expect(resets).toEqual([1]);
		act.grade(3); // the effect's next word goes out afresh
		expect(trainer.roads.at(-1)!.cw).toBeCloseTo(0.51, 9);
	});
});

describe('the write policy, through the FTMS queue (ADR-0084)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('holds over random interleavings of entries, ERG, shifts, terrain, shelter and reconnects', async () => {
		for (let run = 0; run < 20; run++) {
			const rand = seeded(3327 + run);
			const device = new FakeDevice();
			vi.stubGlobal('navigator', {
				bluetooth: { requestDevice: async () => device },
			});
			const trainer = new FtmsTrainer();
			await trainer.connect();
			// A trainer that takes 20–150 ms to answer, so writes queue and coalesce.
			device.control.answer = (frame) => {
				setTimeout(() => device.control.indicate(frame[0]), 20 + rand() * 130);
				return 'silent';
			};

			// What the actuator asked of the trainer, before the queue.
			let op = '';
			let lastFlatAt = -Infinity;
			let composedSinceFlat = true;
			const calls: { op: string; flat: boolean; erg: boolean }[] = [];
			const setSimulation = trainer.setSimulation.bind(trainer);
			trainer.setSimulation = (road) => {
				const flat = bytes(road) === FLAT && !('cw' in road);
				if (flat) {
					expect(trainer.mode).toBe('erg'); // only ever an entry
					lastFlatAt = Date.now();
					composedSinceFlat = false;
				} else composedSinceFlat = true;
				calls.push({ op, flat, erg: false });
				return setSimulation(road);
			};
			const setTargetPower = trainer.setTargetPower.bind(trainer);
			trainer.setTargetPower = (watts) => {
				calls.push({ op, flat: false, erg: true });
				return setTargetPower(watts);
			};

			const act = createActuator(() => trainer);
			let felt = 0;
			let shelter = 0;
			// Every state the actuator stood in, in order: what a write may carry.
			const states: string[] = [];
			const note = () => {
				if (felt !== 0)
					states.push(
						bytes(
							composeSim({ feltPct: felt }, shelter, act.gear.k, true).road,
						),
					);
			};
			for (let i = 0; i < 120; i++) {
				const roll = rand();
				const before = calls.length;
				const entering = Date.now() - lastFlatAt < 500 && !composedSinceFlat;
				if (roll < 0.3) {
					op = 'terrain';
					felt = Math.round((0.5 + rand() * 14.5) * 2) / 2;
					act.road(felt);
				} else if (roll < 0.4) {
					op = 'erg';
					felt = 0;
					act.hold(100 + Math.round(rand() * 200));
				} else if (roll < 0.7) {
					op = 'shift';
					const moved = act.shift(rand() < 0.5 ? 1 : -1);
					const made = calls.slice(before);
					expect(made.some((c) => c.erg)).toBe(false); // no 0x05 from a shift
					expect(made.some((c) => c.flat)).toBe(false); // no flat from a shift
					if (moved && felt !== 0) expect(made.length).toBe(entering ? 0 : 1);
				} else if (roll < 0.8) {
					op = 'shelter';
					shelter = Math.round(rand() * 50) / 100;
					act.shelter(shelter, true);
				} else if (roll < 0.9) {
					op = 'reconnect';
					act.reissue();
				}
				note();
				await vi.advanceTimersByTimeAsync(rand() * 400);
			}
			await vi.advanceTimersByTimeAsync(3000);

			// On the wire: flats, and composed roads in the order they were chosen.
			const wire = device.control.writes.filter((f) => f[0] === 0x11);
			let from = 0;
			for (const frame of wire) {
				const got = Array.from(frame).join();
				if (got === FLAT) continue;
				const found = states.indexOf(got, from);
				expect(
					found,
					`a write no state carried, or out of order`,
				).toBeGreaterThanOrEqual(0);
				from = found;
			}
			// The last one lands.
			if (felt !== 0)
				expect(Array.from(wire.at(-1)!).join()).toBe(states.at(-1));
			const gone = trainer.disconnect();
			await vi.advanceTimersByTimeAsync(500);
			await gone;
		}
	});
});

describe('fairness (ADR-0084)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('moves the dot by the recorded watts to the metre, whatever the gear', async () => {
		const road = gradedRoad([
			...stretch(1, 600),
			...stretch(6, 600),
			...stretch(2, 800),
		]);
		const mass = ReferenceRiderKg + BikeKg;
		const trainer = new SimulatedTrainer({ rng: () => 0.5, cadence: 90 });
		const act = createActuator(() => trainer);
		const grade = createRideGrade();
		const dot = createPace();
		const watts: number[] = [];
		const grades: number[] = [];
		trainer.onSample((s) => {
			act.sample(s);
			const g = at(road, dot.distance).grade;
			watts.push(s.watts);
			grades.push(g);
			dotSecond(dot, s, g, mass, PaceDefaultCdA, 0);
			act.road(grade.at(road, dot.distance, dot.speed));
		});
		await trainer.connect();
		for (let second = 0; second < 240; second++) {
			if (second % 30 === 15) act.shift(second < 120 ? 1 : -1);
			await vi.advanceTimersByTimeAsync(1000);
		}
		expect(new Set(watts).size).toBeGreaterThan(3); // the gears changed the watts

		const replay = createPace();
		watts.forEach((w, i) => replay.step(w, grades[i], mass, PaceDefaultCdA, 0));
		expect(Math.abs(dot.distance - replay.distance)).toBeLessThan(0.5);
	});
});
