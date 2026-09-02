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
	/** In the voice channel at all — absent mic ≠ muted mic (#151). */
	inVoice?: boolean;
	muted: boolean;
	speaking: boolean;
	/** camera-off fallback hue, so the grid isn't uniformly dark */
	hue: number;
	watts: number;
	cadence: number;
	hr: number;
	/** their trainer stopped reporting — numbers are last-known, not live */
	stale: boolean;
	/** they stopped pedalling: their targets pause, the timeline does not wait */
	paused: boolean;
	lateJoined: boolean;
	target: number;
	execution: number;
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
	avatarPreset?: string;
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
		const step = workout?.steps[seg.stepIndex];
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
