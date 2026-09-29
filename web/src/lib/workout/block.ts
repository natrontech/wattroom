import { ZONE_NAMES, zoneOf } from '$lib/components/zones';
import type { TracePoint } from '$lib/components/trace';
import { toleranceBand } from '$lib/workout/guards';
import type { Segment, TargetInfo, Workout } from '$lib/workout/types';

/** How long a finished block's line stays up in the next one (#3090). */
export const LAST_BLOCK_SECONDS = 6;

/**
 * The block a rider is in, as every riding surface reads it — the live
 * shell's, the solo ride's and the ramp test's.
 */
export interface Block {
	/** 1-based position in the flattened timeline, for "block 3 of 6" */
	index: number;
	count: number;
	label: string;
	watts: number;
	secondsLeft: number;
	/** Optional cadence band for this block (#66) — display-only. */
	cadenceLow?: number;
	cadenceHigh?: number;
	/** Optional HR band, bpm (#67) — display-only, never scored (ADR-0008). */
	hrLow?: number;
	hrHigh?: number;
	/** The watts a rider counts as on target — execution's own band. */
	band: { low: number; high: number } | null;
	/** "rep 3 of 5": which pass of a repeated step this is. Absent outside one. */
	rep?: { index: number; count: number };
	/**
	 * How the block just finished went, for the first seconds of this one
	 * (#3090): its average watts and the share of it inside the band. Null
	 * when there is no trace to read, or the last block had no target.
	 */
	last: { watts: number; onTarget: number } | null;
	next: { label: string; watts: number; seconds: number } | null;
}

/**
 * A block's cadence or HR band as a rider reads it, coloured by their own live
 * value (#66, #67 — display-only, never scored). Shared by the TV strip and
 * the Training header: the header never drew the band at all, so a torque
 * block read as "Sweet spot · 240 W" on the surface the rider pedals in
 * front of (audit 2026-09-09).
 */
export function bandText(
	low: number | undefined,
	high: number | undefined,
	unit: string,
	value: number,
): { text: string; unit: string; inBand: boolean } | null {
	const text =
		low !== undefined && high !== undefined
			? `${low}–${high} ${unit}`
			: high !== undefined
				? `under ${high} ${unit}`
				: low !== undefined
					? `over ${low} ${unit}`
					: null;
	if (!text) return null;
	const inBand =
		value > 0 &&
		(low === undefined || value >= low) &&
		(high === undefined || value <= high);
	return { text, unit, inBand };
}

export function blockBands(block: Block | null, cadence: number, hr: number) {
	if (!block) return [];
	return [
		bandText(block.cadenceLow, block.cadenceHigh, 'rpm', cadence),
		bandText(block.hrLow, block.hrHigh, 'bpm', hr),
	].filter((b) => b !== null);
}

const samePath = (a: number[], b: number[]) =>
	a.length === b.length && a.every((n, i) => n === b[i]);

/** The target a segment prescribed at workout-clock second `t`, with the rider's bias. */
function targetOf(seg: Segment, t: number, ftp: number, bias: number): number {
	if (seg.watts !== undefined) return seg.watts * bias;
	const from = seg.fromFraction ?? 0;
	const to = seg.toFraction ?? from;
	const at = Math.min(1, Math.max(0, (t - seg.startSeconds) / seg.seconds));
	return (from + (to - from) * at) * ftp * bias;
}

/** The block that just ended, read off the trace (#3090). */
function lastBlock(
	seg: Segment | undefined,
	trace: TracePoint[],
	ftp: number,
	bias: number,
): Block['last'] {
	if (!seg || seg.kind === 'sprint') return null;
	const end = seg.startSeconds + seg.seconds;
	const points = trace.filter((p) => p.t >= seg.startSeconds && p.t < end);
	if (points.length === 0) return null;
	const inBand = points.filter((p) => {
		const target = targetOf(seg, p.t, ftp, bias);
		return Math.abs(p.w - target) <= toleranceBand(target);
	}).length;
	return {
		watts: Math.round(points.reduce((sum, p) => sum + p.w, 0) / points.length),
		onTarget: Math.round((inBand / points.length) * 100),
	};
}

/** What a rider reads mid-interval: what this block is, how long is left, what's next. */
export function describeBlock(
	info: TargetInfo,
	segments: Segment[],
	workout: Workout | null,
	ftp: number,
	/** The rider's own trace, for the finished block's line; none, no line. */
	trace: TracePoint[] = [],
): Block {
	const label = (seg: Segment | undefined): string => {
		if (!seg) return '';
		if (seg.kind === 'sprint') return 'Sprint';
		const step = workout?.steps[seg.stepPath[0]];
		if (step?.type === 'warmup') return 'Warm-up';
		if (step?.type === 'cooldown') return 'Cool-down';
		const mid =
			((seg.fromFraction ?? 0) + (seg.toFraction ?? seg.fromFraction ?? 0)) / 2;
		return ZONE_NAMES[zoneOf(mid * ftp, ftp)];
	};
	// Trimmed as the current block is (#2835), absolute watts included —
	// targetAt's rule, so the two numbers side by side agree.
	const wattsOf = (seg: Segment | undefined): number => {
		if (!seg || seg.kind === 'sprint') return 0;
		const mid =
			((seg.fromFraction ?? 0) + (seg.toFraction ?? seg.fromFraction ?? 0)) / 2;
		return Math.round((seg.watts ?? mid * ftp) * info.bias);
	};

	const upcoming = segments[info.segmentIndex + 1];
	const watts = info.targetWatts ?? 0;
	const passes = segments.filter((s) =>
		samePath(s.stepPath, info.segment.stepPath),
	);
	const band = watts > 0 ? toleranceBand(watts) : 0;
	return {
		index: info.segmentIndex + 1,
		count: segments.length,
		label: label(info.segment),
		watts,
		band:
			watts > 0
				? { low: Math.round(watts - band), high: Math.round(watts + band) }
				: null,
		rep:
			passes.length > 1
				? {
						index:
							segments
								.slice(0, info.segmentIndex)
								.filter((s) => samePath(s.stepPath, info.segment.stepPath))
								.length + 1,
						count: passes.length,
					}
				: undefined,
		last:
			info.segmentIndex > 0 && info.secondsIntoSegment < LAST_BLOCK_SECONDS
				? lastBlock(segments[info.segmentIndex - 1], trace, ftp, info.bias)
				: null,
		secondsLeft: Math.round(info.secondsRemainingInSegment),
		cadenceLow: info.segment.cadenceLow,
		cadenceHigh: info.segment.cadenceHigh,
		hrLow: info.segment.hrLow,
		hrHigh: info.segment.hrHigh,
		next: upcoming
			? {
					label: label(upcoming),
					watts: wattsOf(upcoming),
					seconds: upcoming.seconds,
				}
			: null,
	};
}
