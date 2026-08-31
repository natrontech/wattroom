/**
 * Zone vocabulary, shared by everything that colours power. Boundaries and names are
 * docs/SPEC.md's; the class names are literal because Tailwind scans source text and
 * would never generate `bg-z${n}`.
 */
import type { Segment } from '$lib/workout/types';

export const CEILING = 1.5;

/** Upper bound of Z1–Z6 as FTP fractions (Z7 is open-ended). */
export const ZONE_TOPS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];

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

export function zoneOf(watts: number, ftp: number): number {
	const fraction = watts / ftp;
	const zone = ZONE_TOPS.findIndex((top) => fraction <= top);
	return zone === -1 ? 7 : zone + 1;
}

/** Seconds a planned workout spends in each zone (index 1–7; sprints count as Z7). */
export function plannedZoneSeconds(segments: Segment[], ftp: number): number[] {
	const out = [0, 0, 0, 0, 0, 0, 0, 0];
	for (const seg of segments) {
		if (seg.kind === 'sprint') {
			out[7] += seg.seconds;
			continue;
		}
		const from =
			seg.watts !== undefined ? seg.watts / ftp : (seg.fromFraction ?? 0);
		const to = seg.watts !== undefined ? from : (seg.toFraction ?? from);
		if (from === to) {
			out[zoneOf(from * ftp, ftp)] += seg.seconds;
			continue;
		}
		// ponytail: per-second walk over ramps — boundary algebra isn't worth it
		for (let s = 0; s < seg.seconds; s++) {
			const f = from + ((to - from) * (s + 0.5)) / seg.seconds;
			out[zoneOf(f * ftp, ftp)] += 1;
		}
	}
	return out;
}

export function fillPct(watts: number, ftp: number): number {
	return Math.min(100, Math.max(0, (watts / ftp / CEILING) * 100));
}
