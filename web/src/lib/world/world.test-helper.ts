import type { GpxPoint } from './gpx';
import type { Route } from './route';
import type { World } from './world';

/**
 * The world invariants both world test files check, one definition each.
 * Test-only: nothing in the app imports it.
 */

/** Terrain faces steeper than 58° (rise over run above 1.6): a fold, not a hillside. */
export function folds(world: World): number {
	const { pos, index } = world.mesh;
	let n = 0;
	const flat = (p: number, q: number) =>
		Math.hypot(pos[p * 3] - pos[q * 3], pos[p * 3 + 2] - pos[q * 3 + 2]);
	for (let t = 0; t < index.length; t += 3) {
		const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
		const ys = [pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]];
		const span = Math.max(flat(a, b), flat(b, c), flat(c, a), 1);
		if ((Math.max(...ys) - Math.min(...ys)) / span > 1.6) n++;
	}
	return n;
}

/** The most the drawn ground rises above the road's centreline, in metres. */
export function worstRiseThroughRoad(route: Route, world: World): number {
	let worst = -Infinity;
	for (let i = 0; i < route.x.length; i += 7)
		worst = Math.max(
			worst,
			world.heightAt(route.x[i], route.z[i]) - route.ele[i],
		);
	return worst;
}

const M_PER_DEG = (Math.PI / 180) * 6371008.8;

/**
 * An ellipse 48 × 30 km round (about 124 km), a GPS fix every 20 m, rolling
 * between 400 and 1200 m three times a lap. It starts on a top, so a stretch
 * that borrowed the start's height would sit 800 m wrong.
 */
export function longLoopPoints(): GpxPoint[] {
	const a = 24_000;
	const b = 15_000;
	const n = 6200;
	const lat0 = 46.6;
	const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
	const out: GpxPoint[] = [];
	for (let i = 0; i <= n; i++) {
		const th = (2 * Math.PI * (i % n)) / n;
		out.push({
			lat: lat0 + (b * Math.sin(th)) / M_PER_DEG,
			lon: 7.6 + (a * Math.cos(th)) / kx,
			ele: 800 + 400 * Math.cos(3 * th),
		});
	}
	return out;
}
