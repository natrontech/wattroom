import type { Segment } from '$lib/workout/types';

/**
 * Zone vocabulary, shared by everything that colours power. Boundaries and names are
 * docs/SPEC.md's; the class names are literal because Tailwind scans source text and
 * would never generate `bg-z${n}`.
 */
export const CEILING = 1.5;

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
	const pct = (watts / ftp) * 100;
	if (pct <= 55) return 1;
	if (pct <= 75) return 2;
	if (pct <= 90) return 3;
	if (pct <= 105) return 4;
	if (pct <= 120) return 5;
	if (pct <= 150) return 6;
	return 7;
}

export function fillPct(watts: number, ftp: number): number {
	return Math.min(100, Math.max(0, (watts / ftp / CEILING) * 100));
}

/** Upper %LTHR edge of HR zones 1–4 (docs/SPEC.md, ADR-0014); Z5 is open-ended. */
const HR_EDGES = [0.68, 0.83, 0.94, 1.05];

/**
 * Heart-rate zone of the rider's OWN bpm (Coggan 5-zone, % of LTHR).
 * Display-only, never scored (ADR-0008). 0 = no LTHR set or no reading.
 */
export function hrZoneOf(bpm: number, lthr: number | undefined): number {
	if (!lthr || bpm <= 0) return 0;
	const pct = bpm / lthr;
	const zone = HR_EDGES.findIndex((edge) => pct <= edge);
	return zone === -1 ? 5 : zone + 1;
}

/** bpm edges of the HR zones for a given LTHR — the profile's read-only table. */
export function hrZoneRanges(
	lthr: number,
): { zone: number; name: string; low: number; high?: number }[] {
	// floor, not round: the high edge is the largest bpm still inside the zone,
	// and rounding up would display a number hrZoneOf puts in the next zone.
	return [1, 2, 3, 4, 5].map((zone) => ({
		zone,
		name: ZONE_NAMES[zone],
		low: zone === 1 ? 0 : Math.floor(HR_EDGES[zone - 2] * lthr) + 1,
		high: zone === 5 ? undefined : Math.floor(HR_EDGES[zone - 1] * lthr),
	}));
}

/**
 * Seconds per power zone (index 1–7) across a flattened timeline — ramps
 * counted at their midpoint, exactly as the interval graph colours them;
 * sprints excluded (slope mode, no ERG target).
 */
export function timeInZones(segments: Segment[], ftp: number): number[] {
	const seconds = Array(8).fill(0) as number[];
	for (const seg of segments) {
		if (seg.kind === 'sprint') continue;
		const mid =
			seg.watts !== undefined
				? seg.watts / ftp
				: ((seg.fromFraction ?? 0) +
						(seg.toFraction ?? seg.fromFraction ?? 0)) /
					2;
		seconds[zoneOf(mid * ftp, ftp)] += seg.seconds;
	}
	return seconds;
}
