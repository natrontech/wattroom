import { GEAR_RATIOS, GEARS } from '$lib/ride/drivetrain';
import type { SimParams } from '$lib/ble/trainer';
import type { ShiftDir } from '$lib/ride/shifter';
import { WHEEL_MM, type Probe, type ProbeStep } from '$lib/ride/gears-probe';

/**
 * The Gears probe's steps (#3331), in the order the Kickr sitting runs them:
 * docs/HARDWARE-SESSIONS.md's virtual-gears checklist, P1–P12, each what the
 * trainer is sent and what the rider does meanwhile. The runner and its log
 * are gears-probe.ts.
 */

/** A gear from the table, as k against the ratio read — or `blind` with none. */
const tableGear = (ratio: number | null, gear: number, blind: number) =>
	ratio ? GEAR_RATIOS[gear - 1] / ratio : blind;

/** Thirty seconds at each road, in order. */
const blocks = (roads: SimParams[]) => async (p: Probe) => {
	for (const road of roads) {
		await p.write(road);
		await p.hold(30);
	}
};

/** Pedal at a flat road long enough for the drivetrain to read the real ratio. */
async function readRatio(p: Probe) {
	await p.write({ gradePct: 0 });
	await p.hold(10);
}

/** `count` presses one way, `gap` seconds apart. */
async function presses(p: Probe, dir: ShiftDir, count: number, gap: number) {
	for (let i = 0; i < count; i++) {
		p.press(dir);
		await p.hold(gap);
	}
}

export const GEARS_PROBE: ProbeStep[] = [
	{
		id: 'P1',
		title: 'Real ratio',
		how: '60 s each at 70, 85 and 100 rpm at 0 %, then the same at 5 %. With a cassette, again in two more real gears.',
		run: async (p) => {
			for (const gradePct of [0, 5]) {
				await p.write({ gradePct });
				await p.hold(180);
			}
		},
	},
	{
		id: 'P4',
		title: 'Mass',
		how: '85 rpm in one real gear: 30 s each at 0, 2, 4 and 0 %.',
		run: blocks([0, 2, 4, 0].map((gradePct) => ({ gradePct }))),
	},
	{
		id: 'P2a',
		title: 'Crr',
		how: '85 rpm at 0 %: Crr 0.004, 0.008, 0.004, 30 s each.',
		run: blocks([0.004, 0.008, 0.004].map((crr) => ({ gradePct: 0, crr }))),
	},
	{
		id: 'P2b',
		title: 'Cw',
		how: '85 rpm at 0 %: Cw 0.51, 0.77, 0.33, 0.26, 0.51 kg/m, 30 s each.',
		run: blocks(
			[0.51, 0.77, 0.33, 0.26, 0.51].map((cw) => ({ gradePct: 0, cw })),
		),
	},
	{
		id: 'P5',
		title: 'Circumference',
		how: '85 rpm: 2096, 4192, 1048, 2096 mm, 30 s each, at 5 % and then at 0 %.',
		run: async (p) => {
			for (const gradePct of [5, 0]) {
				await p.write({ gradePct });
				for (const mm of [WHEEL_MM, WHEEL_MM * 2, WHEEL_MM / 2, WHEEL_MM]) {
					await p.circumference(mm);
					await p.hold(30);
				}
			}
		},
	},
	{
		id: 'P6',
		title: 'Shift step',
		how: '85 rpm at felt 3 %: ten shifts up and ten down by ×1.0907, then by ×1.5, 15 s apart. Rate each one.',
		run: async (p) => {
			await p.road(3, 1);
			await p.hold(15);
			for (const step of [GEARS.blindStep, 1.5])
				for (let i = 0; i < 20; i++) {
					await p.shift(i % 2 === 0 ? step : 1);
					await p.hold(15);
				}
		},
	},
	{
		id: 'P7',
		title: 'Writes per shift',
		how: 'Nothing to ride: counts the writes of every P6 shift in the log.',
	},
	{
		id: 'P8',
		title: 'Burst',
		how: '85 rpm at felt 3 %: five presses within a second, three times.',
		run: async (p) => {
			p.ride(3);
			await p.hold(5);
			for (const dir of [1, -1, 1] as const) {
				await presses(p, dir, 5, 0.2);
				await p.hold(15);
			}
		},
	},
	{
		id: 'P9',
		title: 'Torque ceiling',
		how: 'The smallest practical real gear, 60 rpm: felt 10 % in gear 1 for 60 s.',
		run: async (p) => {
			await readRatio(p);
			await p.road(10, tableGear(p.ratio, 1, GEARS.blindMin));
			await p.hold(60);
		},
	},
	{
		id: 'P10',
		title: 'Sprint',
		how: 'At felt 3 %: four Harder, a 10 s sprint, four Easier, three times.',
		run: async (p) => {
			p.ride(3);
			await p.hold(5);
			for (let i = 0; i < 3; i++) {
				await presses(p, 1, 4, 0.2);
				await p.hold(10);
				await presses(p, -1, 4, 0.2);
				await p.hold(30);
			}
		},
	},
	{
		id: 'P11',
		title: 'Descent',
		how: 'Felt −5 % in each of the top three gears, 40 s each, then grades of −2, −5 and −10 %, 30 s each.',
		run: async (p) => {
			await readRatio(p);
			for (const gear of [GEARS.count - 2, GEARS.count - 1, GEARS.count]) {
				const blind = GEARS.blindMax / GEARS.blindStep ** (GEARS.count - gear);
				await p.road(-5, tableGear(p.ratio, gear, blind));
				await p.hold(40);
			}
			await blocks([-2, -5, -10].map((gradePct) => ({ gradePct })))(p);
		},
	},
	{
		id: 'P12',
		title: 'Core 2 with a Cog or Click',
		how: 'Kickr Core 2 only, with the Cog or Click present: ERG 200 W, then felt 3 %, 30 s each.',
		run: async (p) => {
			await p.erg(200);
			await p.hold(30);
			await p.road(3, 1);
			await p.hold(30);
		},
	},
];
