import { gradeAt, heightAt } from './at-metre';
import { classedOf, type Climb, type ClimbClass } from './climbs';
import type { Road } from './road';

/**
 * The road at a rider's metre (#3060): one shape for every surface that says
 * where they are — slot 1's "km 12.4 of 52.9 · 7.6 % · top in 3.2 km", the
 * HUD feed, and whatever reads either. Computed once, from the road as this
 * lap rides it, so no two surfaces round a climb differently.
 */
export interface RoadReadout {
	/** The grade under the rider, in %. */
	grade: number;
	km: number;
	totalKm: number;
	/** Metres to the top of the classed climb the rider is on; absent off one. */
	toTopM?: number;
	/** That climb: its class, and which of the road's classed climbs it is. */
	climb?: { cls: ClimbClass; n: number; of: number };
	/** The next classed climb ahead, and metres to its foot; absent past the last. */
	next?: { cls: ClimbClass; inM: number };
	/** The next 2 km in 100 m bars, each its grade in %; fewer in the road's last 2 km. */
	ahead?: number[];
}

// The issue's numbers: the next 2 km, in 100 m bars.
const BAR_M = 100;
const BARS = 20;

/**
 * The readout m metres along `road`, which is the road as ridden — turned
 * round on a lap ridden backwards — with `climbs` its climbs (climbsOf, read
 * once per road rather than once a second).
 */
export function roadReadout(
	road: Road,
	climbs: Climb[],
	m: number,
): RoadReadout {
	const at = Math.min(Math.max(m, 0), road.length);
	const readout: RoadReadout = {
		grade: gradeAt(road, at),
		km: at / 1000,
		totalKm: road.length / 1000,
	};
	const classed = classedOf(climbs);
	const i = classed.findIndex((c) => c.startM <= at && at < c.topM);
	if (i >= 0) {
		readout.toTopM = classed[i].topM - at;
		readout.climb = { cls: classed[i].cls, n: i + 1, of: classed.length };
	}
	const next = classed.find((c) => c.startM > at);
	if (next) readout.next = { cls: next.cls, inM: next.startM - at };
	const ahead: number[] = [];
	for (let k = 0; k < BARS && at + (k + 1) * BAR_M <= road.length; k++) {
		const from = at + k * BAR_M;
		ahead.push(
			((heightAt(road, from + BAR_M) - heightAt(road, from)) / BAR_M) * 100,
		);
	}
	if (ahead.length > 0) readout.ahead = ahead;
	return readout;
}
