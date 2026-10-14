import { formatClock } from '$lib/format';

/**
 * The frame a finished ride is shown in (#3686): the closing card wears it
 * now and the ride page wears it next (#3687), so both say a ride the same
 * way — one eyebrow, one row of tiles, the same labels in the same order.
 */

/** One tile: an eyebrow label, a number, and the unit it is counted in. */
export interface RecapTile {
	label: string;
	value: string;
	unit?: string;
}

/** What a ride's tiles are made from. Absent means the ride has no answer. */
export interface RecapNumbers {
	seconds: number;
	kj?: number;
	avgWatts?: number;
	normWatts?: number;
	/** 0–1; absent when nothing scorable was ridden (#1454). */
	execution?: number;
	xp?: number;
}

/**
 * The ride page's six numbers in the ride page's order, three by two. A
 * number the ride has no answer for drops its tile rather than showing 0:
 * a zero there reads as a ride that went nowhere.
 */
export function recapTiles(ride: RecapNumbers): RecapTile[] {
	const tiles: (RecapTile | false)[] = [
		ride.seconds > 0 && { label: 'duration', value: formatClock(ride.seconds) },
		!!ride.kj && { label: 'work', value: String(ride.kj), unit: 'kJ' },
		!!ride.avgWatts && {
			label: 'average',
			value: String(ride.avgWatts),
			unit: 'W',
		},
		!!ride.normWatts && {
			label: 'normalised',
			value: String(ride.normWatts),
			unit: 'W',
		},
		ride.execution !== undefined && {
			label: 'execution',
			value: String(Math.round(ride.execution * 100)),
			unit: '%',
		},
		ride.xp !== undefined && {
			label: 'earned',
			value: String(ride.xp),
			unit: 'XP',
		},
	];
	return tiles.filter((tile): tile is RecapTile => tile !== false);
}

/** The ride's mode, as docs/SPEC.md's glossary names the five. */
export type RideKind = 'Free ride' | 'Workout' | 'Bunch ride' | 'Race' | 'Game';

/**
 * “<weekday> · <ride kind> · Solo|<crew>” — the eyebrow over a finished
 * ride's title (TARGETS.md, closing-card). The `eyebrow` utility upper-cases
 * it; the words stay in sentence case for a screen reader.
 */
export function recapEyebrow(
	when: Date,
	kind: RideKind,
	crew?: string,
): string {
	const weekday = when.toLocaleDateString(undefined, { weekday: 'long' });
	return [weekday, kind, crew || 'Solo'].join(' · ');
}
