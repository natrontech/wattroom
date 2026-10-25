import { describe, expect, it } from 'vitest';
import {
	BikeKg,
	BunchMaxPct,
	PaceDefaultCdA,
	ReferenceRiderWatts,
} from '$lib/protocol';
import { createRoadRide } from '$lib/ride/road-ride';
import { flatten, segmentsDuration, targetAt } from '$lib/workout/engine';
import type { Workout } from '$lib/workout/types';
import { gradeAt } from './at-metre';
import { alpineLoop, legsRoad } from './fixtures';
import {
	GATES,
	landsOn,
	paintedGates,
	REFERENCE,
	rideAhead,
	type Pacer,
} from './gates';
import { matchTerrain } from './match';
import { createPace } from './pace';
import { turnedRound } from './road';

const steady = (seconds: number, target: number) =>
	({ type: 'steady', seconds, target }) as const;

/** A short session's shape: blocks up and down, a repeat and a sprint, so every gate kind comes up. */
const workout: Workout = {
	name: 'Gates',
	steps: [
		{ type: 'warmup', seconds: 300, from: 0.45, to: 0.7 },
		{
			type: 'repeat',
			times: 3,
			steps: [steady(240, 0.95), steady(120, 0.55)],
		},
		{ type: 'sprint', seconds: 15 },
		steady(180, 0.6),
		{ type: 'cooldown', seconds: 240, from: 0.55, to: 0.4 },
	],
};
const segments = flatten(workout);
const total = segmentsDuration(segments);

// Terrain Match's start on the synthetic Alpine loop (#3581), the road as ridden from it.
const loop = alpineLoop();
const start = matchTerrain(loop, workout, true).best;
const road = start.reverse ? turnedRound(loop) : loop;

const FTP = 260;
const KG = 72;
const you: Pacer = { ftp: FTP, bias: 1, kg: KG + BikeKg };
const reference = REFERENCE;

/** What ERG holds the pacer to at second t; a sprint at the bunch's most. */
function heldWatts(t: number, p: Pacer): number {
	const info = targetAt(segments, p.ftp, t, { bias: p.bias });
	if (info.targetWatts !== null) return info.targetWatts;
	return info.segment.kind === 'sprint' ? BunchMaxPct * p.ftp : 0;
}

/**
 * The ride, on an injected clock: a sample a second, the dot moved by what
 * the rider made, and the gates worked out again each second, as the riding
 * screen does. For every gate ever shown, the second the dot rode over it.
 */
function rideThrough(
	step: (t: number) => { m: number; mps: number },
	pacer: Pacer,
): { block: number; shownAt: number; crossedAt: number }[] {
	const out: { block: number; shownAt: number; crossedAt: number }[] = [];
	const shown: { block: number; m: number; shownAt: number }[] = [];
	let here = { m: start.startM, mps: 0 };
	for (let t = 0; t < total; t++) {
		for (const g of rideAhead({
			segments,
			t,
			m: here.m,
			mps: here.mps,
			road,
			loop: true,
			pacer,
		}).gates)
			shown.push({ block: g.index, m: g.m, shownAt: t });
		const before = here.m;
		here = step(t);
		for (const s of shown.filter((g) => before < g.m && g.m <= here.m))
			// The second the dot passed it, to the fraction of that second's metres.
			out.push({
				block: s.block,
				shownAt: s.shownAt,
				crossedAt: t + (s.m - before) / (here.m - before),
			});
	}
	return out;
}

describe('the next blocks on the road (#3101)', () => {
	it('shows the next three, in order, ahead of the rider', () => {
		const { gates } = rideAhead({
			segments,
			t: 10,
			m: start.startM,
			mps: 7,
			road,
			loop: true,
			pacer: you,
		});
		expect(gates.map((g) => g.index)).toEqual([1, 2, 3]);
		expect(gates.map((g) => Math.round(g.inS))).toEqual([290, 530, 650]);
		for (let i = 1; i < GATES; i++)
			expect(gates[i].m).toBeGreaterThan(gates[i - 1].m);
		expect(gates[0].m).toBeGreaterThan(start.startM);
	});

	// The issue's bar is 1 s: alone, ERG holds whole watts where the plan
	// rides the prescription. A bunch is the hub's own model, so it holds to
	// a tenth, and a gate a second out fails.
	const BUNCH_S = 0.1;

	it('lands each gate within 1 s of its block starting, alone on your own target', () => {
		const ride = createRoadRide(road, { kg: () => KG, from: start.startM });
		const crossed = rideThrough((t) => {
			const r = ride.second(heldWatts(t, you), t * 1000);
			return { m: r.m, mps: r.virtualMps };
		}, you);
		// Every block after the first was shown, and ridden over.
		expect(new Set(crossed.map((c) => c.block)).size).toBe(segments.length - 1);
		for (const c of crossed)
			expect(
				Math.abs(c.crossedAt - segments[c.block].startSeconds),
			).toBeLessThanOrEqual(1);
	}, 30_000);

	it('lands each gate within 1 s for a bunch, at the reference rider the hub steps', () => {
		// The hub's bunch (hub/world.go): a whole second at the plan of the
		// second just ridden, the reference rider at the block's %FTP unrounded.
		const hubWatts = (t: number) => {
			const seg = segments.find(
				(s) => t >= s.startSeconds && t < s.startSeconds + s.seconds,
			)!;
			if (seg.kind === 'sprint') return BunchMaxPct * ReferenceRiderWatts;
			const from = seg.fromFraction ?? 0;
			const to = seg.toFraction ?? from;
			const into = (t - seg.startSeconds) / seg.seconds;
			return (from + (to - from) * into) * ReferenceRiderWatts;
		};
		const pace = createPace();
		const crossed = rideThrough((t) => {
			const m = start.startM + pace.distance;
			pace.step(
				hubWatts(t),
				gradeAt(road, m % road.length),
				reference.kg,
				PaceDefaultCdA,
				0,
			);
			return { m: start.startM + pace.distance, mps: pace.speed };
		}, reference);
		expect(new Set(crossed.map((c) => c.block)).size).toBe(segments.length - 1);
		for (const c of crossed)
			expect(
				Math.abs(c.crossedAt - segments[c.block].startSeconds),
			).toBeLessThan(BUNCH_S);
	}, 30_000);

	it('puts a road workout’s gates on its pins, whatever the pace', () => {
		const flat = legsRoad([10_000, 0]);
		const pinned = flatten({
			name: 'Pinned',
			steps: [steady(60, 0.6), steady(60, 0.9), steady(60, 0.5)],
		});
		const pins = { fromM: 100, stepEndM: [600, 1500, 2100] };
		for (const mps of [4, 9]) {
			const { gates } = rideAhead({
				segments: pinned,
				t: 0,
				m: 100,
				mps,
				road: flat,
				pacer: you,
				pins,
			});
			expect(gates.map((g) => [g.index, g.m])).toEqual([
				[1, 600],
				[2, 1500],
			]);
		}
	});

	it('paints your target in describeBlock’s words, a sprint among them', () => {
		const ahead = rideAhead({
			segments,
			t: 1300,
			m: start.startM,
			mps: 7,
			road,
			loop: true,
			pacer: reference,
		});
		// Paced by the reference rider, worded at your FTP and trim.
		expect(
			paintedGates(ahead, segments, workout, { ftp: FTP, bias: 0.95 }),
		).toEqual([
			expect.objectContaining({ words: 'SPRINT', sprint: true }),
			expect.objectContaining({ words: 'ENDURANCE 148 W', sprint: false }),
			expect.objectContaining({ words: 'COOL-DOWN 117 W', sprint: false }),
		]);
	});

	it('names the block that lands on a climb, and when its foot comes', () => {
		const ahead = rideAhead({
			segments,
			t: 400,
			m: start.startM,
			mps: 7,
			road,
			loop: true,
			pacer: you,
		});
		const foot = ahead.gates[1].m - start.startM + 50;
		const line = landsOn(ahead, foot, segments, workout, FTP);
		expect(line).toMatch(/^Starts in \d+:\d\d, during Threshold 2$/);
		expect(landsOn(ahead, 0, segments, workout, FTP)).toBeNull();
	});
});
