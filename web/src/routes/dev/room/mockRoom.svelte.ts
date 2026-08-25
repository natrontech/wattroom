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

/**
 * Ride-critical faults. .claude/rules/errors.md: these are persistent dashboard
 * status, never a toast — the rider is on a bike three metres from the screen.
 */
export type Fault =
	| { kind: 'trainer'; state: 'reconnecting' | 'lost' }
	| { kind: 'room'; state: 'reconnecting' | 'lost' };

export const ROOM_NAME = 'Thursday Sufferfest';

/** Optional per-tile metrics. Zwift shows everyone's HR; whether you want it is taste. */
export type TileMetric = 'hr' | 'cadence' | 'wkg';
export const TILE_METRICS: { id: TileMetric; label: string }[] = [
	{ id: 'hr', label: 'HR' },
	{ id: 'cadence', label: 'Cadence' },
	{ id: 'wkg', label: 'w/kg' },
];

/** Power bars and the interval graph all top out at 150 % FTP — one ceiling, one constant. */
export const CEILING = 1.5;

export function fillPct(watts: number, ftp: number): number {
	return Math.min(100, Math.max(0, (watts / ftp / CEILING) * 100));
}

export function formatClock(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/** docs/SPEC.md: within ±5 % of target, floor ±10 W. */
function bandWatts(target: number): number {
	return Math.max(target * 0.05, 10);
}

/** Shared by the ride screen's notch bar and TV mode's delta — same data, two distances. */
export function targetState(rider: MockRider) {
	const has = rider.target > 0;
	const band = has ? bandWatts(rider.target) : 0;
	const delta = rider.watts - rider.target;
	return { has, band, delta, inBand: has && Math.abs(delta) <= band };
}

/** Names from docs/SPEC.md's zone table — indexed by zone number. */
export const ZONE_NAMES = [
	'',
	'Active recovery',
	'Endurance',
	'Tempo',
	'Threshold',
	'VO₂ max',
	'Anaerobic',
	'Neuromuscular',
];

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
	/** their trainer stopped reporting — their numbers are last-known, not live */
	stale: boolean;
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
	/** resting-HR spread: two riders at the same %FTP are nowhere near the same bpm */
	hrOffset: number;
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
		hrOffset: -12,
	},
	{
		name: 'Ruben',
		ftp: 310,
		kg: 78,
		hue: 198,
		cameraOn: true,
		discipline: 1.06,
		hrOffset: 7,
	},
	{
		name: 'Milo',
		ftp: 195,
		kg: 71,
		hue: 22,
		cameraOn: false,
		muted: true,
		discipline: 0.94,
		hrOffset: 14,
	},
	{
		name: 'Sara',
		ftp: 285,
		kg: 66,
		hue: 330,
		cameraOn: true,
		discipline: 0.99,
		hrOffset: -6,
	},
	{
		name: 'Tobi',
		ftp: 225,
		kg: 83,
		hue: 150,
		cameraOn: false,
		discipline: 1.03,
		hrOffset: 18,
	},
	{
		name: 'You',
		ftp: 265,
		kg: 74,
		hue: 290,
		you: true,
		cameraOn: true,
		discipline: 1.0,
		hrOffset: 0,
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

export interface Block {
	/** 1-based position in the flattened timeline, for "block 3 of 6" */
	index: number;
	count: number;
	label: string;
	watts: number;
	secondsLeft: number;
	next: { label: string; watts: number; seconds: number } | null;
}

/** What a rider reads mid-interval: what this block is, how long is left, what's next. */
function describeBlock(
	info: ReturnType<typeof targetAt>,
	segments: Segment[],
	ftp: number,
	bias: number,
): Block {
	const label = (seg: Segment | undefined): string => {
		if (!seg) return '';
		if (seg.kind === 'sprint') return 'Sprint';
		const step = workout.steps[seg.stepIndex];
		if (step?.type === 'warmup') return 'Warm-up';
		if (step?.type === 'cooldown') return 'Cool-down';
		const mid =
			((seg.fromFraction ?? 0) + (seg.toFraction ?? seg.fromFraction ?? 0)) / 2;
		return ZONE_NAMES[zoneOf(mid * ftp, ftp)];
	};
	const wattsOf = (seg: Segment | undefined): number => {
		if (!seg || seg.kind === 'sprint') return 0;
		if (seg.watts !== undefined) return Math.round(seg.watts * bias);
		const mid =
			((seg.fromFraction ?? 0) + (seg.toFraction ?? seg.fromFraction ?? 0)) / 2;
		return Math.round(mid * ftp * bias);
	};

	const upcoming = segments[info.segmentIndex + 1];
	return {
		index: info.segmentIndex + 1,
		count: segments.length,
		label: label(info.segment),
		watts: info.targetWatts ?? 0,
		secondsLeft: Math.round(info.secondsRemainingInSegment),
		next: upcoming
			? {
					label: label(upcoming),
					watts: wattsOf(upcoming),
					seconds: upcoming.seconds,
				}
			: null,
	};
}

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
	/** Rider-facing intensity trim, the one control riders reach for mid-interval. */
	let bias = $state(1);
	let fault = $state<Fault | null>(null);
	/** Buffered locally while the room link is down (#19 IndexedDB ride buffer). */
	let bufferedSeconds = $state(0);
	let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
	let block = $state<Block | null>(null);
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
			stale: false,
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
						: Math.round(
								Math.min(
									195,
									96 + SEEDS[i].hrOffset + (sample.watts / rider.ftp) * 78,
								),
							);
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
			if (fault?.kind === 'room') bufferedSeconds += SPEED;
			const next = elapsed + SPEED;
			// Looping back to the warmup would smear stale samples across the graph.
			if (next >= total) for (const rider of riders) rider.trace = [];
			elapsed = next % total;
			SEEDS.forEach((seed, i) => {
				const info = targetAt(segments, seed.ftp, elapsed, {
					bias: seed.you ? bias : 1,
				});
				riders[i].target = info.targetWatts ?? 0;
				void trainers[i].setTargetPower(
					Math.round((info.targetWatts ?? 0) * seed.discipline),
				);
				if (seed.you) block = describeBlock(info, segments, seed.ftp, bias);
			});
		}, 1000);
	}

	function stop() {
		clearInterval(ticker);
		clearInterval(voice);
		clearTimeout(recoveryTimer);
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
		/** Recovery is automatic where it can be; the manual path is one big button. */
		breakTrainer(recovers: boolean) {
			const you = SEEDS.findIndex((seed) => seed.you);
			riders[you].stale = true;
			fault = { kind: 'trainer', state: 'reconnecting' };
			clearTimeout(recoveryTimer);
			recoveryTimer = setTimeout(() => {
				if (recovers) {
					riders[you].stale = false;
					fault = null;
				} else {
					fault = { kind: 'trainer', state: 'lost' };
				}
			}, 6000);
		},
		breakRoom(recovers: boolean) {
			fault = { kind: 'room', state: 'reconnecting' };
			bufferedSeconds = 0;
			clearTimeout(recoveryTimer);
			recoveryTimer = setTimeout(() => {
				fault = recovers ? null : { kind: 'room', state: 'lost' };
			}, 6000);
		},
		recover() {
			clearTimeout(recoveryTimer);
			for (const rider of riders) rider.stale = false;
			fault = null;
			bufferedSeconds = 0;
		},
		get fault() {
			return fault;
		},
		get bufferedSeconds() {
			return bufferedSeconds;
		},
		nudgeBias(step: number) {
			// ±1 % steps, clamped: a trim, not a way to rewrite the workout.
			bias = Math.min(
				1.2,
				Math.max(0.8, Math.round((bias + step) * 100) / 100),
			);
		},
		get bias() {
			return bias;
		},
		get block() {
			return block;
		},
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
