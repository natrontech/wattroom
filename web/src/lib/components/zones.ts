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
