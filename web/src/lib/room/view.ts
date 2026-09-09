import { ZONE_NAMES, zoneOf } from '$lib/components/zones';
import type { Segment, TargetInfo, Workout } from '$lib/workout/types';

/**
 * The room screen's view model (#39's design, made real): one rider shape the
 * designed components render, fed by live ticks instead of the mock generator.
 * The dev mock produces the same shape, which is what keeps /dev/room honest.
 */
export interface RoomRider {
	id: string;
	name: string;
	ftp: number;
	kg: number;
	you: boolean;
	coach: boolean;
	cameraOn: boolean;
	/** Their screen is live in the room (#664) — marked on the tile, since the stage need not move. */
	sharing?: boolean;
	/** In the voice channel at all — absent mic ≠ muted mic (#151). */
	inVoice?: boolean;
	muted: boolean;
	speaking: boolean;
	/** The rider explicitly stepped out; presence, never inferred from watts. */
	away?: boolean;
	/** Pedalling inside the room's window (#1016) — the server's word, not this
	 * tile's reading of the current sample. A coast holds it. */
	riding?: boolean;
	/** camera-off fallback hue, so the grid isn't uniformly dark */
	hue: number;
	watts: number;
	cadence: number;
	hr: number;
	/** their trainer stopped reporting — numbers are last-known, not live */
	stale: boolean;
	target: number;
	/** The live score; absent until something scorable was ridden (#1454). */
	execution?: number;
	trace: { t: number; w: number }[];
	eliminated?: boolean;
}

/**
 * A room's member as the room's own screens render them. The tick's roster is
 * the live truth and carries no faces; this is who the room HAS, which is also
 * the only way to know who is not here.
 */
export interface RoomMember {
	id: string;
	displayName: string;
	avatarUrl?: string;
	totalXp?: number;
}

export type TileMetric = 'hr' | 'cadence' | 'wkg';
export const TILE_METRICS: { id: TileMetric; label: string }[] = [
	{ id: 'hr', label: 'bpm' },
	{ id: 'cadence', label: 'rpm' },
	{ id: 'wkg', label: 'w/kg' },
];

/** docs/SPEC.md tolerance band: ±5 % of target, floor ±10 W. */
export function bandWatts(target: number): number {
	return Math.max(target * 0.05, 10);
}

export function targetState(rider: Pick<RoomRider, 'watts' | 'target'>) {
	const has = rider.target > 0;
	const band = has ? bandWatts(rider.target) : 0;
	const delta = rider.watts - rider.target;
	return { has, band, delta, inBand: has && Math.abs(delta) <= band };
}

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
