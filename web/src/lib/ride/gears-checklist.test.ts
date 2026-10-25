import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSimulation, FtmsTrainer } from '$lib/ble/ftms';
import { FakeDevice } from '$lib/ble/fake-gatt.test-helper';
import { SimulatedTrainer, type RealRatio } from '$lib/ble/simulated';
import { resolveSim, trainerForce, type SimParams } from '$lib/ble/trainer';
import {
	BikeKg,
	MaxTrainerGrade,
	MinTrainerGrade,
	PaceDrivetrainEfficiency,
	PaceGravity,
	ReferenceRiderKg,
} from '$lib/protocol';
import { composeSim } from './actuation.svelte';
import {
	GEAR_RATIOS,
	GEARS,
	ratioState,
	REAL_RATIO,
	trackRatio,
} from './drivetrain';
import { WHEEL_MM, type ProbeEvent } from './gears-probe';
import { dryRunOn } from './gears-probe.test-helper';

/**
 * docs/HARDWARE-SESSIONS.md's virtual-gears checklist, P1 to P12, each held
 * to its "passes when" on the SimulatedTrainer and the fake GATT: the gate
 * ADR-0088 put in the Kickr sitting's place before gears reach every rider
 * (#3333). What the trainer does with a road comes from docs/SPEC.md
 * "Virtual gears" and RESEARCH.md §11, "The road and gears numbers".
 */

type Sample = Extract<ProbeEvent, { kind: 'sample' }>;
type Write = Extract<ProbeEvent, { kind: 'write' }>;

/** The SimulatedTrainer's own road: the reference rider on the reference bike. */
const MASS = ReferenceRiderKg + BikeKg;
const COG: RealRatio = { chainring: 34, cog: 14 };

const rider = (opts: ConstructorParameters<typeof SimulatedTrainer>[0] = {}) =>
	new SimulatedTrainer({ cadence: 85, rng: () => 0.5, ...opts });

/** The flywheel's speed at `rpm` in a real gear, m/s. */
const flywheel = (rpm: number, { chainring, cog }: RealRatio) =>
	(rpm / 60) * (chainring / cog) * REAL_RATIO.wheelMetres;

/** The watts a road asks at flywheel speed v. A trainer brakes and never drives. */
const modelWatts = (road: SimParams, v: number) =>
	Math.max(
		0,
		(trainerForce(resolveSim(road), MASS, v) * v) / PaceDrivetrainEfficiency,
	);

const roadOf = (w: Write): SimParams => ({
	gradePct: w.grade,
	crr: w.crr,
	cw: w.cw,
	windMps: w.wind,
});

const samples = (events: ProbeEvent[]) =>
	events.filter((e): e is Sample => e.kind === 'sample');
const writes = (events: ProbeEvent[], op = 0x11) =>
	events.filter((e): e is Write => e.kind === 'write' && e.op === op);

/** What each block settled at: the last sample before each later write, and the last of all. */
function settled(events: ProbeEvent[]): number[] {
	const out: number[] = [];
	let last: Sample | undefined;
	for (const e of events) {
		if (e.kind === 'write') {
			if (last) out.push(last.watts);
			last = undefined;
		} else if (e.kind === 'sample') last = e;
	}
	if (last) out.push(last.watts);
	return out;
}

/** An FTMS trainer on the fake GATT, its control point answering after `ackMs`. */
function wired(ackMs = 0) {
	const device = new FakeDevice();
	const asked: RequestDeviceOptions[] = [];
	vi.stubGlobal('navigator', {
		bluetooth: {
			requestDevice: async (opts: RequestDeviceOptions) => {
				asked.push(opts);
				return device;
			},
		},
	});
	const sent: { op: number; at: number; acked?: number }[] = [];
	let inFlight = 0;
	let most = 0;
	device.control.answer = (frame) => {
		const write = { op: frame[0], at: Date.now() } as (typeof sent)[number];
		sent.push(write);
		most = Math.max(most, ++inFlight);
		const ack = () => {
			inFlight--;
			write.acked = Date.now();
		};
		if (ackMs === 0) {
			ack();
			return 'ack';
		}
		setTimeout(() => {
			ack();
			device.control.indicate(frame[0]);
		}, ackMs);
		return 'silent';
	};
	return { device, trainer: new FtmsTrainer(), asked, sent, most: () => most };
}

/** The frames a run wrote, short of disconnect's hand-back: ERG 0 W, last (#1848). */
function ridden(device: FakeDevice): number[][] {
	const frames = device.control.writes.map((f) => Array.from(f));
	expect(frames.at(-1)).toEqual([0x05, 0, 0]);
	return frames.slice(0, -1);
}

describe('the virtual-gears checklist (ADR-0088)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it.each([
		[34, 14],
		[50, 17],
		[50, 13],
	])(
		'P1 reads %i×%i within ±5 % at 70, 85 and 100 rpm, the same at 5 % as at 0 %',
		async (chainring, cog) => {
			const teeth = chainring / cog;
			for (const cadence of [70, 85, 100]) {
				const { events } = await dryRunOn(
					rider({ cadence, ratio: { chainring, cog } }),
					'P1',
				);
				const climb = events.indexOf(writes(events)[1]);
				const flat = samples(events.slice(0, climb)).at(-1)!.ratio!;
				const up = samples(events).at(-1)!.ratio!;
				expect(Math.abs(flat / teeth - 1)).toBeLessThan(0.05);
				expect(Math.abs(up / teeth - 1)).toBeLessThan(0.05);
				// Off by 5 % between grades, detection would ship off.
				expect(Math.abs(up / flat - 1)).toBeLessThan(0.05);
			}
		},
	);

	it('P4 fits the trainer’s mass from 0 → 2 → 4 → 0 % with R² ≥ 0.95, and the composer sends none', async () => {
		const { events } = await dryRunOn(rider(), 'P4');
		const v = flywheel(85, COG);
		// F = m_t·g·(sin θ + Crr·cos θ) + ½·Cw·v²: a line in g·(sin θ + Crr·cos θ).
		const xs = writes(events).map((w) => {
			const theta = Math.atan(w.grade / 100);
			return PaceGravity * (Math.sin(theta) + w.crr * Math.cos(theta));
		});
		const ys = settled(events).map((w) => (w * PaceDrivetrainEfficiency) / v);
		const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
		const [mx, my] = [mean(xs), mean(ys)];
		let sxy = 0;
		let sxx = 0;
		let syy = 0;
		xs.forEach((x, i) => {
			sxy += (x - mx) * (ys[i] - my);
			sxx += (x - mx) ** 2;
			syy += (ys[i] - my) ** 2;
		});
		expect((sxy * sxy) / (sxx * syy)).toBeGreaterThanOrEqual(0.95);
		expect(Math.abs(sxy / sxx / MASS - 1)).toBeLessThan(0.05);
		// m/m_t is 1 (SPEC): a felt grade goes out as itself at k = 1, whoever rides.
		for (const felt of [2, 4, -3])
			expect(
				composeSim({ feltPct: felt }, 0, 1, false).road.gradePct,
			).toBeCloseTo(felt, 9);
	});

	it('P2a moves the watts by the Crr step within ±25 %, by at least 5 W', async () => {
		const { events } = await dryRunOn(rider(), 'P2a');
		const [a, b, c] = settled(events);
		const v = flywheel(85, COG);
		const model =
			modelWatts({ gradePct: 0, crr: 0.008 }, v) -
			modelWatts({ gradePct: 0, crr: 0.004 }, v);
		for (const step of [b - a, b - c]) {
			expect(step).toBeGreaterThanOrEqual(5);
			expect(Math.abs(step / model - 1)).toBeLessThanOrEqual(0.25);
		}
		expect(
			new Uint8Array(encodeSimulation({ gradePct: 0, crr: 0.008 }))[5],
		).toBe(80);
	});

	it('P2b moves the watts by ½·ΔCw·v³ within ±25 %: Cw is ρ·CdA', async () => {
		const { events } = await dryRunOn(rider(), 'P2b');
		const watts = settled(events);
		const cws = writes(events).map((w) => w.cw);
		expect(cws).toEqual([0.51, 0.77, 0.33, 0.26, 0.51]);
		const v = flywheel(85, COG);
		for (let i = 1; i < cws.length; i++) {
			const model =
				modelWatts({ gradePct: 0, cw: cws[i] }, v) -
				modelWatts({ gradePct: 0, cw: cws[i - 1] }, v);
			const step = watts[i] - watts[i - 1];
			expect(Math.abs(step)).toBeGreaterThanOrEqual(5);
			expect(Math.abs(step / model - 1)).toBeLessThanOrEqual(0.25);
		}
		expect(new Uint8Array(encodeSimulation({ gradePct: 0, cw: 0.77 }))[6]).toBe(
			77,
		);
	});

	it('P5 finds the circumference display-only, and no ride ever sends one', async () => {
		const { events } = await dryRunOn(rider(), 'P5');
		// Settled per circumference: four at 5 %, then four at 0 %.
		const watts = settled(events);
		expect(watts).toHaveLength(8);
		for (const block of [watts.slice(0, 4), watts.slice(4)])
			expect(Math.max(...block) - Math.min(...block)).toBeLessThanOrEqual(1);
		expect(writes(events, 0x12).map((w) => w.circumference)).toEqual([
			WHEEL_MM,
			WHEEL_MM * 2,
			WHEEL_MM / 2,
			WHEEL_MM,
			WHEEL_MM,
			WHEEL_MM * 2,
			WHEEL_MM / 2,
			WHEEL_MM,
		]);

		// A road wheel another app set (700×32c) still reads within 3 % (SPEC).
		const ratio = ratioState();
		for (let i = 0; i < 20; i++)
			trackRatio(ratio, {
				watts: 200,
				cadence: 85,
				speedMps: (85 / 60) * (34 / 14) * 2.155,
				at: i * 1000,
			});
		expect(Math.abs(ratio.ratio! / (34 / 14) - 1)).toBeLessThan(0.03);

		// A ride's presses send none on the wire (ftms.test.ts scans the source).
		const ride = wired();
		await dryRunOn(ride.trainer, 'P10');
		expect(ride.sent.some((w) => w.op === 0x12)).toBe(false);
	});

	it('P6 sends each shift at the press, acked within 250 ms, and lands ≥ 90 % of its step in the first full sample', async () => {
		// A trainer with its own fast control loop (ADR-0084).
		const { events } = await dryRunOn(rider({ tauSeconds: 0.3 }), 'P6');
		const v = flywheel(85, COG);
		const shifts = events.flatMap((e, i) => (e.kind === 'shift' ? [i] : []));
		expect(shifts).toHaveLength(40);
		for (const i of shifts) {
			const write = events[i + 1] as Write;
			const before = samples(events.slice(0, i)).at(-1)!.watts;
			const first = samples(events.slice(i)).find(
				(s) => s.ms >= events[i].ms + 1000,
			)!.watts;
			const step = modelWatts(roadOf(write), v) - before;
			expect(Math.abs(first - before)).toBeGreaterThanOrEqual(
				0.9 * Math.abs(step),
			);
		}

		// On the wire, behind a trainer that takes 120 ms to answer.
		const slow = wired(120);
		const wire = await dryRunOn(slow.trainer, 'P6');
		const logged = writes(wire.events);
		const sims = slow.sent.filter((w) => w.op === 0x11);
		expect(sims).toHaveLength(logged.length);
		const offset = sims[0].at - logged[0].ms;
		sims.forEach((w, i) => {
			expect(w.at - offset).toBe(logged[i].ms);
			expect(w.acked! - w.at).toBeLessThanOrEqual(250);
		});
	});

	it('P7 writes one 0x11 a press and no mode change, and the power never falls 10 % below the gears either side', async () => {
		const { device, trainer } = wired();
		const { events } = await dryRunOn(trainer, 'P10');
		// What the ride asked of the trainer, press by press: one write each.
		const asked = events.reduce<number[]>((n, e) => {
			if (e.kind === 'press') n.push(0);
			else if (e.kind === 'write' && n.length) n[n.length - 1]++;
			return n;
		}, []);
		expect(asked).toHaveLength(24);
		expect(asked.every((n) => n === 1)).toBe(true);
		const presses = asked.length;
		const ops = ridden(device).map((f) => f[0]);
		// Request control, then the entry flat and the road, then one per press.
		expect(ops[0]).toBe(0x00);
		expect(ops.slice(1).every((op) => op === 0x11)).toBe(true);
		expect(ops.length - 3).toBe(presses);

		const sim = await dryRunOn(rider(), 'P6');
		const shifts = sim.events.flatMap((e, i) =>
			e.kind === 'shift' ? [i] : [],
		);
		shifts.forEach((at, n) => {
			const between = samples(sim.events.slice(at, shifts[n + 1]));
			const before = samples(sim.events.slice(0, at)).at(-1)!.watts;
			const after = between.at(-1)!.watts;
			const floor = 0.9 * Math.min(before, after);
			expect(between.every((s) => s.watts >= floor)).toBe(true);
		});
	});

	it('P8 keeps one write in flight through a burst, lands the target and never times out', async () => {
		const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
		const slow = wired(350);
		const { events } = await dryRunOn(slow.trainer, 'P8');
		const presses = events.filter((e) => e.kind === 'press').length;
		const sims = slow.device.control.writes.filter((f) => f[0] === 0x11);
		expect(slow.most()).toBe(1);
		// The entry flat and the road went before the first press.
		expect(sims.length - 2).toBeLessThan(presses);
		// Up five, down five, up five: five gears up, blind (no samples here).
		const target = composeSim({ feltPct: 3 }, 0, GEARS.blindStep ** 5, false);
		expect(Array.from(sims.at(-1)!)).toEqual(
			Array.from(new Uint8Array(encodeSimulation(target.road))),
		);
		expect(failed).not.toHaveBeenCalled();
	});

	it('P9 meets the model in the easiest gear at felt 10 % and 60 rpm, inside the write range', async () => {
		const real: RealRatio = { chainring: 34, cog: 28 };
		const { events } = await dryRunOn(
			rider({ cadence: 60, ratio: real }),
			'P9',
		);
		const write = writes(events).at(-1)!;
		expect(write.grade).toBeLessThan(MaxTrainerGrade);
		const v = flywheel(60, real);
		// ADR-0084: the trainer resists with k·F(k·v) at its own speed v.
		const model =
			(write.k *
				trainerForce(resolveSim({ gradePct: 10 }), MASS, write.k * v) *
				v) /
			PaceDrivetrainEfficiency;
		const watts = samples(events).at(-1)!.watts;
		expect(Math.abs(watts / model - 1)).toBeLessThanOrEqual(0.1);
		// Gear 1 from that real gear is no saturation either.
		const gear1 = composeSim(
			{ feltPct: 10 },
			0,
			GEAR_RATIOS[0] / (34 / 28),
			false,
		);
		expect(gear1.clamp).toBeNull();
	});

	it('P10 never reports cadence 0 above 20 W through four up, a sprint and four down, and stays in SIM', async () => {
		const { trainer, events } = await dryRunOn(rider(), 'P10');
		expect(samples(events).every((s) => s.watts <= 20 || s.cadence > 0)).toBe(
			true,
		);
		expect(trainer.writes.every((w) => w.op === 'sim')).toBe(true);
	});

	it('P11 holds every descent to MinTrainerGrade, and the watts to the model or the trainer’s floor', async () => {
		const { events } = await dryRunOn(rider(), 'P11');
		const sims = writes(events);
		for (const w of sims) {
			expect(w.grade).toBeGreaterThanOrEqual(MinTrainerGrade);
			expect(w.grade).toBeLessThanOrEqual(MaxTrainerGrade);
		}
		// The top gear asks for more than −10 % at felt −5 %, and is held there.
		expect(sims.some((w) => w.grade === MinTrainerGrade && w.k > 2)).toBe(true);
		const v = flywheel(85, COG);
		settled(events).forEach((watts, i) => {
			const model = modelWatts(roadOf(sims[i]), v);
			expect(Math.abs(watts - model)).toBeLessThanOrEqual(
				Math.max(2, 0.15 * model),
			);
		});
	});

	it('P12 rides ERG and then SIM over FTMS alone, and never asks for another service', async () => {
		const { device, trainer, asked } = wired();
		await dryRunOn(trainer, 'P12');
		// FTMS and Cycling Power: no Zwift service is ever named (ADR-0084 rule 4).
		expect(asked[0].optionalServices).toEqual([0x1826, 0x1818]);
		expect(new Set(device.services)).toEqual(new Set([0x1826]));
		const frames = ridden(device);
		expect(frames.map((f) => f[0])).toEqual([0x00, 0x05, 0x11]);
		expect(frames[1]).toEqual([0x05, 200, 0]);
		expect(frames[2]).toEqual(
			Array.from(
				new Uint8Array(
					encodeSimulation(composeSim({ feltPct: 3 }, 0, 1, false).road),
				),
			),
		);
	});
});
