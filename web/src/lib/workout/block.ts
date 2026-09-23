import { ZONE_NAMES, zoneOf } from '$lib/components/zones';
import type { Segment, TargetInfo, Workout } from '$lib/workout/types';

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

/** What a rider reads mid-interval: what this block is, how long is left, what's next. */
export function describeBlock(
	info: TargetInfo,
	segments: Segment[],
	workout: Workout | null,
	ftp: number,
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
	const wattsOf = (seg: Segment | undefined): number => {
		if (!seg || seg.kind === 'sprint') return 0;
		if (seg.watts !== undefined) return Math.round(seg.watts);
		const mid =
			((seg.fromFraction ?? 0) + (seg.toFraction ?? seg.fromFraction ?? 0)) / 2;
		return Math.round(mid * ftp);
	};

	const upcoming = segments[info.segmentIndex + 1];
	return {
		index: info.segmentIndex + 1,
		count: segments.length,
		label: label(info.segment),
		watts: info.targetWatts ?? 0,
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
