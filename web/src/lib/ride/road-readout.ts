import { formatKm } from '$lib/format';
import { climbsOf, type Climb } from '$lib/road/climbs';
import { roadReadout, type RoadReadout } from '$lib/road/readout';
import { turnedRound, type Road } from '$lib/road/road';

/**
 * One ride's road readout (#3639): the road as this lap rides it — turned
 * round on a lap ridden back — with its climbs read once per road and way,
 * never once a second. `m` is metres along the stored road, as a ride's
 * samples keep it.
 */
export function createRoadReadout() {
	let last: {
		road: Road;
		reverse: boolean;
		ridden: Road;
		climbs: Climb[];
	} | null = null;
	return (road: Road, m: number, reverse = false): RoadReadout => {
		if (last?.road !== road || last.reverse !== reverse) {
			const ridden = reverse ? turnedRound(road) : road;
			last = { road, reverse, ridden, climbs: climbsOf(ridden) };
		}
		return roadReadout(last.ridden, last.climbs, reverse ? road.length - m : m);
	};
}

/** Slot 1's words for it (#3639): "km 12.4 of 52.9 · 7.6 % · top in 3.2 km". */
export function roadLine(r: RoadReadout): string {
	const parts = [
		`km ${r.km.toFixed(1)} of ${r.totalKm.toFixed(1)}`,
		`${r.grade.toFixed(1)} %`,
	];
	if (r.toTopM !== undefined) parts.push(`top in ${formatKm(r.toTopM)} km`);
	return parts.join(' · ');
}
