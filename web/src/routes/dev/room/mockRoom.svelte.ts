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
/** docs/SPEC.md: 10 s countdown before the shared timeline starts. */
const COUNTDOWN = 10;

/** Room idles as a voice/jukebox lounge, then runs a shared timeline (docs/SPEC.md). */
export type Phase = 'lounge' | 'countdown' | 'live';

/** docs/SPEC.md: within ±5 % of target, floor ±10 W. */
export function bandWatts(target: number): number {
	return Math.max(target * 0.05, 10);
}

/** Shared by the ride screen's notch bar and TV mode's delta — same data, two distances. */
export function targetState(rider: MockRider) {
	const has = rider.target > 0;
	const band = has ? bandWatts(rider.target) : 0;
	const delta = rider.watts - rider.target;
	return { has, band, delta, inBand: has && Math.abs(delta) <= band };
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
	cameraOn: boolean;
	muted: boolean;
	speaking: boolean;
	/** stand-in for a camera feed's dominant colour, so the grid isn't uniformly dark */
	hue: number;
	watts: number;
	cadence: number;
	hr: number;
	target: number;
	execution: number;
	trace: { t: number; w: number }[];
}

interface RiderSeed {
	name: string;
	ftp: number;
	kg: number;
	hue: number;
	you?: boolean;
	coach?: boolean;
	cameraOn?: boolean;
	muted?: boolean;
	/** how faithfully they hold the target — 1.0 nails it, 1.06 always overcooks */
	discipline: number;
}

const SEEDS: RiderSeed[] = [
	{
		name: 'Nina',
		ftp: 240,
		kg: 62,
		hue: 268,
		coach: true,
		cameraOn: true,
		discipline: 1.01,
	},
	{
		name: 'Ruben',
		ftp: 310,
		kg: 78,
		hue: 198,
		cameraOn: true,
		discipline: 1.06,
	},
	{
		name: 'Milo',
		ftp: 195,
		kg: 71,
		hue: 22,
		cameraOn: false,
		muted: true,
		discipline: 0.94,
	},
	{
		name: 'Sara',
		ftp: 285,
		kg: 66,
		hue: 330,
		cameraOn: true,
		discipline: 0.99,
	},
	{
		name: 'Tobi',
		ftp: 225,
		kg: 83,
		hue: 150,
		cameraOn: false,
		discipline: 1.03,
	},
	{
		name: 'You',
		ftp: 265,
		kg: 74,
		hue: 290,
		you: true,
		cameraOn: true,
		discipline: 1.0,
	},
];

export const rooms = [
	{ name: 'Thursday Sufferfest', members: 6, live: true },
	{ name: 'Sunday Long Ride', members: 2, live: false },
	{ name: 'Natron Lunch Crew', members: 0, live: false },
	{ name: 'Winter Base Camp', members: 4, live: false },
];

/** Scripted so the panel feels inhabited. Text chat is a fast-follow (WATTROOM.md), mocked here to prove the layout. */
export const chatSeed = [
	{ who: 'Nina', text: 'ftp test next week or are we all cowards' },
	{ who: 'Ruben', text: 'cowards' },
	{ who: 'Milo', text: 'my trainer is making a noise again' },
	{ who: 'Sara', text: 'thats just your knees milo' },
];

export const chatLater = [
	{ who: 'Tobi', text: 'sorry late, kid meltdown' },
	{ who: 'Nina', text: 'ur fine were still in warmup' },
	{ who: 'Ruben', text: 'this is not sweet spot this is threshold' },
	{ who: 'Milo', text: 'speak for yourself' },
	{ who: 'Sara', text: '🔥' },
];

export const queue = [
	{ title: 'Kavinsky — Nightcall', length: '4:18', by: 'Nina' },
	{ title: 'The Midnight — Los Angeles', length: '6:02', by: 'Ruben' },
	{ title: 'Carpenter Brut — Turbo Killer', length: '4:41', by: 'You' },
	{ title: 'Perturbator — Sentient', length: '5:29', by: 'Sara' },
];

/**
 * A room of simulated riders on one workout, across the phases a real room moves
 * through. Every tile is a real SimulatedTrainer holding a real ERG target.
 */
export function createRoom() {
	const segments: Segment[] = flatten(workout);
	const total = segments.reduce(
		(t, s) => Math.max(t, s.startSeconds + s.seconds),
		0,
	);

	let elapsed = $state(0);
	let phase = $state<Phase>('lounge');
	let countdown = $state(COUNTDOWN);

	const riders = $state<MockRider[]>(
		SEEDS.map((s) => ({
			name: s.name,
			ftp: s.ftp,
			kg: s.kg,
			you: s.you ?? false,
			coach: s.coach ?? false,
			cameraOn: s.cameraOn ?? false,
			muted: s.muted ?? false,
			speaking: false,
			hue: s.hue,
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
	let ticker: ReturnType<typeof setInterval> | undefined;
	let voice: ReturnType<typeof setInterval> | undefined;
	let turn = 0;

	async function start() {
		await Promise.all(trainers.map((t) => t.connect()));
		trainers.forEach((trainer, i) => {
			trainer.onSample((sample) => {
				const rider = riders[i];
				rider.watts = sample.watts;
				rider.cadence = sample.cadence;
				rider.hr =
					sample.watts < 20
						? 0
						: Math.round(Math.min(190, 96 + (sample.watts / rider.ftp) * 78));
				if (rider.target > 0) {
					banded[i].ridden++;
					if (Math.abs(sample.watts - rider.target) <= bandWatts(rider.target))
						banded[i].inside++;
					rider.execution = banded[i].inside / banded[i].ridden;
				}
				if (phase === 'live')
					rider.trace = [...rider.trace, { t: elapsed, w: sample.watts }].slice(
						-120,
					);
			});
		});

		// Someone is always talking in a lounge; VAD gating means one at a time.
		voice = setInterval(() => {
			turn = (turn + 1) % riders.length;
			riders.forEach((r, i) => (r.speaking = i === turn && !r.muted));
		}, 2600);

		ticker = setInterval(() => {
			if (phase === 'countdown') {
				countdown -= 1;
				if (countdown <= 0) phase = 'live';
			}
			if (phase !== 'live') {
				// Nobody is holding a target in the lounge; power decays to zero on its own.
				for (const trainer of trainers) void trainer.setTargetPower(0);
				return;
			}
			const next = elapsed + SPEED;
			// Looping back to the warmup would smear stale samples across the graph.
			if (next >= total) for (const rider of riders) rider.trace = [];
			elapsed = next % total;
			SEEDS.forEach((seed, i) => {
				const { targetWatts } = targetAt(segments, seed.ftp, elapsed);
				riders[i].target = targetWatts ?? 0;
				void trainers[i].setTargetPower(
					Math.round((targetWatts ?? 0) * seed.discipline),
				);
			});
		}, 1000);
	}

	function stop() {
		clearInterval(ticker);
		clearInterval(voice);
		void Promise.all(trainers.map((t) => t.disconnect()));
	}

	function setPhase(next: Phase) {
		if (next === 'countdown') countdown = COUNTDOWN;
		if (next === 'lounge') {
			elapsed = 0;
			for (const rider of riders) {
				rider.target = 0;
				rider.trace = [];
			}
		}
		phase = next;
	}

	return {
		segments,
		total,
		riders,
		start,
		stop,
		setPhase,
		get elapsed() {
			return elapsed;
		},
		get phase() {
			return phase;
		},
		get countdown() {
			return countdown;
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
