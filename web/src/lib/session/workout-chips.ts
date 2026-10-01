import { plannedZoneSeconds } from '$lib/components/zones';
import type { Segment } from '$lib/workout/types';

/**
 * What a workout asks for, as the session picker's chips (#115): the minutes
 * in each zone, in the graph's colours, and the cadence and heart-rate bands
 * (#66, #67) — the picker was where they had been invisible.
 */

/** Minutes per zone, zones with none left out, a minute at the least. */
export function zoneChips(segments: Segment[], ftp: number) {
	return plannedZoneSeconds(segments, ftp)
		.map((seconds, zone) => ({ zone, seconds }))
		.filter((entry) => entry.zone > 0 && entry.seconds > 0)
		.map((entry) => ({
			zone: entry.zone,
			minutes: Math.max(1, Math.round(entry.seconds / 60)),
		}));
}

/** Each band once: "85–95 rpm", "under 150 bpm", "over 90 rpm". */
export function bandChips(segments: Segment[]): string[] {
	const chips = new Set<string>();
	const phrase = (low: number | undefined, high: number | undefined) =>
		low !== undefined && high !== undefined
			? `${low}–${high}`
			: high !== undefined
				? `under ${high}`
				: `over ${low}`;
	for (const seg of segments) {
		if (seg.cadenceLow !== undefined || seg.cadenceHigh !== undefined)
			chips.add(`${phrase(seg.cadenceLow, seg.cadenceHigh)} rpm`);
		if (seg.hrLow !== undefined || seg.hrHigh !== undefined)
			chips.add(`${phrase(seg.hrLow, seg.hrHigh)} bpm`);
	}
	return [...chips];
}
