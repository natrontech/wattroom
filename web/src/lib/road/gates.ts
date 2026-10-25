/**
 * The next blocks on the road ahead (#3101): where each one starts, found by
 * riding the plan forward a second at a time on the pace model, at the watts
 * it prescribes, so the paint lands where the block starts. A bunch rides
 * the reference rider (ADR-0065), as the hub steps it; a rider alone rides
 * their own target on their own weight, as their dot does.
 */
import {
	BikeKg,
	BunchMaxPct,
	PaceDefaultCdA,
	ReferenceRiderKg,
	ReferenceRiderWatts,
} from '$lib/protocol';
import { formatClock } from '$lib/format';
import { blockLabel, blockWatts, repOf } from '$lib/workout/block';
import { segmentsDuration, targetAt } from '$lib/workout/engine';
import { roadSecond } from '$lib/workout/road-workout';
import type { Segment, Workout } from '$lib/workout/types';
import { gradeAt } from './at-metre';
import { createPace } from './pace';
import type { Road } from './road';

/** The issue's three: the blocks a rider sees coming. */
export const GATES = 3;
/** The plan is ridden ahead an hour at most. */
const HORIZON_S = 3600;

/** Whose pace the plan is ridden at: the watts it prescribes are theirs. */
export type Pacer = {
	ftp: number;
	/** 1 for a bunch: a personal trim never moves everyone's road. */
	bias: number;
	/** Rider and bike, kg. */
	kg: number;
};

/** The reference rider a bunch is paced at (ADR-0065), as the hub steps it. */
export const REFERENCE: Pacer = {
	ftp: ReferenceRiderWatts,
	bias: 1,
	kg: ReferenceRiderKg + BikeKg,
};

export type Plan = {
	segments: Segment[];
	/** The workout second now. */
	t: number;
	/** Metres along the road as ridden, laps unrolled, and the speed there. */
	m: number;
	mps: number;
	road: Road;
	loop?: boolean;
	pacer: Pacer;
	/** A road workout's pins, in the same metres (#3499): a block ends at its metre, never by the clock. */
	pins?: { fromM: number; stepEndM: number[] };
};

/** Where a block starts, ahead. */
export type Gate = {
	/** The block that starts here, its index in the segments. */
	index: number;
	/** Metres along the road as ridden, laps unrolled. */
	m: number;
	/** Seconds from now. */
	inS: number;
};

export type Ahead = {
	gates: Gate[];
	/** When the rider has ridden `aheadM` more metres, and the block they ride then; null past what was ridden ahead. */
	reach(aheadM: number): { inS: number; index: number } | null;
};

/** The watts a workout second prescribes this pacer; null where it prescribes none, which holds the speed. */
function wattsAt(segments: Segment[], t: number, p: Pacer): number | null {
	const info = targetAt(segments, p.ftp, t, { bias: p.bias });
	if (info.done) return null;
	if (info.targetWatts !== null) return info.targetWatts;
	// A sprint rides at the bunch's most (ADR-0065's table), as Terrain Match times one.
	return info.segment.kind === 'sprint' ? BunchMaxPct * p.ftp : null;
}

export function rideAhead(plan: Plan): Ahead {
	const { segments, road, pacer, pins } = plan;
	const total = segmentsDuration(segments);
	const second = (s: number, m: number) =>
		pins ? roadSecond(segments, pins, m) : s;
	const blockAt = (s: number, m: number) =>
		targetAt(segments, pacer.ftp, second(s, m)).segmentIndex;
	const pace = createPace(plan.mps);
	const gates: Gate[] = [];
	// Metres ahead and the block ridden, after each whole second.
	const trail = [0];
	const blocks = [blockAt(plan.t, plan.m)];
	let m = plan.m;
	let s = plan.t;
	for (let k = 1; k <= HORIZON_S && gates.length < GATES; k++) {
		if (second(s, m) >= total || (!plan.loop && m >= road.length)) break;
		const watts = wattsAt(segments, second(s, m), pacer);
		const from = m;
		if (watts === null) m += pace.speed;
		else {
			const before = pace.distance;
			const at = plan.loop ? m % road.length : m;
			pace.step(watts, gradeAt(road, at), pacer.kg, PaceDefaultCdA, 0);
			m += pace.distance - before;
		}
		s += 1;
		const index = blockAt(s, m);
		trail.push(m - plan.m);
		blocks.push(index);
		if (index === blocks[k - 1] || !segments[index]) continue;
		// Where inside this second the block began: at its pin, or as far back
		// as the clock has run past its start.
		const startM = pins
			? pins.stepEndM[index - 1]
			: m - (s - segments[index].startSeconds) * (m - from);
		const into = m > from ? (m - startM) / (m - from) : 0;
		gates.push({ index, m: startM, inS: k - into });
	}
	return {
		gates,
		reach(aheadM) {
			const k = trail.findIndex((d) => d >= aheadM);
			if (k < 0) return null;
			if (k === 0) return { inS: 0, index: blocks[0] };
			const f = (aheadM - trail[k - 1]) / (trail[k] - trail[k - 1]);
			return { inS: k - 1 + f, index: blocks[k] };
		},
	};
}

/** A gate as the world paints it. */
export type PaintedGate = {
	/** The block's index in the segments: the same gate from one second to the next. */
	index: number;
	m: number;
	/** describeBlock's name and the watts (D16), as the road says them: "TEMPO 220 W". */
	words: string;
	/** A sprint's gate stands a banner from 1 km out. */
	sprint: boolean;
};

/** The gates ahead in the words a rider reads them: your FTP and trim, whoever paces the road. */
export function paintedGates(
	ahead: Ahead,
	segments: Segment[],
	workout: Workout | null,
	you: { ftp: number; bias: number },
): PaintedGate[] {
	return ahead.gates.map(({ index, m }) => {
		const seg = segments[index];
		const watts = blockWatts(seg, you.ftp, you.bias);
		return {
			index,
			m,
			words: [blockLabel(seg, workout, you.ftp), watts > 0 ? `${watts} W` : '']
				.filter(Boolean)
				.join(' ')
				.toUpperCase(),
			sprint: seg.kind === 'sprint',
		};
	});
}

/**
 * The climb card's line (#3101): the block that lands on the climb and when
 * its foot comes, "Starts in 1:40, during Threshold 2". Null once on it, or
 * past what the plan was ridden ahead.
 */
export function landsOn(
	ahead: Ahead,
	toFootM: number,
	segments: Segment[],
	workout: Workout | null,
	ftp: number,
): string | null {
	if (toFootM <= 0) return null;
	const there = ahead.reach(toFootM);
	if (!there) return null;
	const rep = repOf(segments, there.index);
	const block = blockLabel(segments[there.index], workout, ftp);
	return `Starts in ${formatClock(Math.round(there.inS))}, during ${block}${rep ? ` ${rep.index}` : ''}`;
}

/** A ride's next blocks as its surfaces draw them: the gates the world paints, and the climb card's line. */
export function blocksAhead(
	plan: Plan,
	workout: Workout | null,
	you: { ftp: number; bias: number },
): { gates: PaintedGate[]; lands: (toFootM: number) => string | null } {
	const ahead = rideAhead(plan);
	return {
		gates: paintedGates(ahead, plan.segments, workout, you),
		lands: (toFootM) =>
			landsOn(ahead, toFootM, plan.segments, workout, you.ftp),
	};
}
