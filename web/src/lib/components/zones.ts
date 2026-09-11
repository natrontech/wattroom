/**
 * Zone vocabulary, shared by everything that colours power. Boundaries and names are
 * docs/SPEC.md's; the class names are literal because Tailwind scans source text and
 * would never generate `bg-z${n}`.
 */
import type { Segment, WorkoutStep } from '$lib/workout/types';

export const CEILING = 1.5;

/** Upper bound of Z1–Z6 as FTP fractions (Z7 is open-ended). */
const ZONE_TOPS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];

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

/**
 * The same ramp as CSS custom properties, for the places a Tailwind class
 * cannot reach — an SVG `stop-color`, which takes a paint and not a class.
 */
export const ZONE_VAR = [
	'',
	'var(--color-z1)',
	'var(--color-z2)',
	'var(--color-z3)',
	'var(--color-z4)',
	'var(--color-z5)',
	'var(--color-z6)',
	'var(--color-z7)',
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

/** One zone's slice of a vertical axis, as fractions from the axis's floor. */
export interface ZoneBand {
	zone: number;
	from: number;
	to: number;
}

/**
 * The ramp laid against an axis whose full height is `top` watts (#1559) —
 * what turns a flat trace into one coloured by effort, the way the downloadable
 * ride card colours its own.
 *
 * Bands, not a blend: between Z3 and Z4 there is no colour, there is a
 * boundary, and a gradient that fades across it paints wattages a colour no
 * zone owns. A caller emits two stops per band to keep the edge hard.
 */
export function zoneBands(ftp: number, top: number): ZoneBand[] {
	if (!(ftp > 0) || !(top > 0)) return [];
	const bands: ZoneBand[] = [];
	let from = 0;
	for (let zone = 1; zone <= 7 && from < 1; zone++) {
		// Z7 is open-ended, so the axis's own ceiling closes it.
		const edge =
			zone === 7 ? 1 : Math.min(1, (ZONE_TOPS[zone - 1] * ftp) / top);
		if (edge <= from) continue;
		bands.push({ zone, from, to: edge });
		from = edge;
	}
	return bands;
}

export function zoneOf(watts: number, ftp: number): number {
	const fraction = watts / ftp;
	const zone = ZONE_TOPS.findIndex((top) => fraction <= top);
	return zone === -1 ? 7 : zone + 1;
}

/**
 * Zone of one planned step at a given FTP. 0 for a repeat or a sprint — neither
 * has a single target to colour (a repeat's children carry their own, and a
 * sprint is all-out by definition).
 */
export function zoneOfStep(step: WorkoutStep, ftp: number): number {
	if (step.type === 'repeat' || step.type === 'sprint') return 0;
	if (step.type === 'steady') {
		// An absolute-watt step has no fraction to read; scoring it as 0 %
		// painted every one of them Z1 whatever it actually asked for.
		const fraction =
			step.watts !== undefined ? step.watts / ftp : (step.target ?? 0);
		return zoneOf(fraction * ftp, ftp);
	}
	return zoneOf(((step.from + step.to) / 2) * ftp, ftp);
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

/**
 * Where a wattage sits on the instrument's track. The full scale defaults
 * to FTP × CEILING — the room and the solo ride — and a ramp test passes
 * its own top (#1565): scaled to a stale FTP, the one workout defined by
 * riding far above it pinned the bar at 1.5 × FTP for its last third.
 */
export function fillPct(
	watts: number,
	ftp: number,
	fullScale: number = ftp * CEILING,
): number {
	return Math.min(100, Math.max(0, (watts / fullScale) * 100));
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
