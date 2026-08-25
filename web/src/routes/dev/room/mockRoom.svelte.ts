import { SimulatedTrainer } from '$lib/ble/simulated';
import { flatten, targetAt } from '$lib/workout/engine';
import type { Segment, Workout } from '$lib/workout/types';

export const workout: Workout = {
	name: 'Sweet Spot 2×20',
	steps: [
		{ type: 'warmup', seconds: 600, from: 0.45, to: 0.7 },
		{
			type: 'repeat',
			times: 2,
			steps: [
				{ type: 'steady', seconds: 1200, target: 0.9 },
				{ type: 'steady', seconds: 300, target: 0.55 },
			],
		},
		{ type: 'cooldown', seconds: 300, from: 0.6, to: 0.4 },
	],
};

/** Workout-clock seconds per real second, so a 65 min session is watchable in 8. */
const SPEED = 8;

/** docs/SPEC.md: within ±5 % of target, floor ±10 W. */
function inBand(watts: number, target: number): boolean {
	return Math.abs(watts - target) <= Math.max(target * 0.05, 10);
}

/** Coggan 7-zone, boundaries per docs/SPEC.md. */
export function zoneOf(watts: number, ftp: number): number {
	const pct = (watts / ftp) * 100;
	if (pct <= 55) return 1;
	if (pct <= 75) return 2;
	if (pct <= 90) return 3;
	if (pct <= 105) return 4;
	if (pct <= 120) return 5;
	if (pct <= 150) return 6;
	return 7;
}

export interface MockRider {
	name: string;
	ftp: number;
	kg: number;
	you: boolean;
	coach: boolean;
	watts: number;
	cadence: number;
	hr: number;
	target: number;
	/** seconds ridden inside the tolerance band / seconds ridden */
	execution: number;
	/** workout-clock timestamped samples, so the trace lines up with the timeline */
	trace: { t: number; w: number }[];
}

interface RiderSeed {
	name: string;
	ftp: number;
	kg: number;
	you?: boolean;
	coach?: boolean;
	/** how faithfully they hold the target — 1.0 nails it, 1.06 always overcooks */
	discipline: number;
}

const SEEDS: RiderSeed[] = [
	{ name: 'You', ftp: 265, kg: 74, you: true, discipline: 1.0 },
	{ name: 'Nina', ftp: 240, kg: 62, coach: true, discipline: 1.01 },
	{ name: 'Ruben', ftp: 310, kg: 78, discipline: 1.06 },
	{ name: 'Milo', ftp: 195, kg: 71, discipline: 0.94 },
	{ name: 'Sara', ftp: 285, kg: 66, discipline: 0.99 },
	{ name: 'Tobi', ftp: 225, kg: 83, discipline: 1.03 },
];

/**
 * A room of simulated riders on the same workout. Every tile is a real
 * SimulatedTrainer holding a real ERG target — the numbers move the way they
 * will in the app, which is the only way to judge glow and density.
 */
export function createRoom() {
	const segments: Segment[] = flatten(workout);
	const total = segments.reduce(
		(t, s) => Math.max(t, s.startSeconds + s.seconds),
		0,
	);

	let elapsed = $state(0);
	const riders = $state<MockRider[]>(
		SEEDS.map((s) => ({
			name: s.name,
			ftp: s.ftp,
			kg: s.kg,
			you: s.you ?? false,
			coach: s.coach ?? false,
			watts: 0,
			cadence: 0,
			hr: 0,
			target: 0,
			execution: 1,
			trace: [],
		})),
	);

	const trainers = SEEDS.map(
		(s) =>
			new SimulatedTrainer({
				baseWatts: s.ftp * 0.7,
				tauSeconds: 2.5,
				noiseWatts: 6,
			}),
	);
	const banded = SEEDS.map(() => ({ inside: 0, ridden: 0 }));
	let timer: ReturnType<typeof setInterval> | undefined;

	async function start() {
		await Promise.all(trainers.map((t) => t.connect()));
		trainers.forEach((trainer, i) => {
			trainer.onSample((sample) => {
				const rider = riders[i];
				rider.watts = sample.watts;
				rider.cadence = sample.cadence;
				// HR trails effort; enough to make the tile honest, not a physiology model.
				const effort = sample.watts / rider.ftp;
				rider.hr = Math.round(Math.min(190, 96 + effort * 78));
				if (rider.target > 0) {
					banded[i].ridden++;
					if (inBand(sample.watts, rider.target)) banded[i].inside++;
					rider.execution = banded[i].inside / banded[i].ridden;
				}
				rider.trace = [...rider.trace, { t: elapsed, w: sample.watts }].slice(
					-120,
				);
			});
		});

		timer = setInterval(() => {
			const next = elapsed + SPEED;
			// Looping back to the warmup would smear stale samples across the whole graph.
			if (next >= total) for (const rider of riders) rider.trace = [];
			elapsed = next % total;
			SEEDS.forEach((seed, i) => {
				const { targetWatts } = targetAt(segments, seed.ftp, elapsed);
				const target = Math.round((targetWatts ?? 0) * seed.discipline);
				riders[i].target = targetWatts ?? 0;
				void trainers[i].setTargetPower(target);
			});
		}, 1000);
	}

	function stop() {
		clearInterval(timer);
		void Promise.all(trainers.map((t) => t.disconnect()));
	}

	return {
		segments,
		total,
		riders,
		start,
		stop,
		get elapsed() {
			return elapsed;
		},
	};
}

/** Literal class names: Tailwind scans source text, so `text-z${n}` would never be generated. */
export const ZONE_TEXT = [
	'',
	'text-z1',
	'text-z2',
	'text-z3',
	'text-z4',
	'text-z5',
	'text-z6',
	'text-z7',
];
export const ZONE_BG = [
	'',
	'bg-z1',
	'bg-z2',
	'bg-z3',
	'bg-z4',
	'bg-z5',
	'bg-z6',
	'bg-z7',
];
