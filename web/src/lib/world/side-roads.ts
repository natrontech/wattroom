/**
 * The other roads of a map, as the road ridden meets them (designed.ts): a
 * map's loops share stretches of road, and where another loop leaves the
 * one ridden its road is there to see, a junction and a road going off to
 * the lake or up the pass. Each is a stretch of that loop's own line, from
 * where it leaves this road (or a stretch already kept) to where it comes
 * back: a road with two ends, drawn and built on as the ridden one is,
 * never ridden. Three-free.
 */
import type { Route } from '#lib/road/route.ts';

/** A side road starts where its line is this far from every road kept so far: past both formations. */
const CLEAR_M = 11;
/** A stretch shorter than this is two roads brushing past one another, not a road. */
const MIN_M = 60;
/** A sample lies on a road kept so far within this of one of its points, which stand 3.4 m apart; and a side road is drawn at most this many samples into one to reach it. */
const ON_M = 3.6;
const REACH = 8;
/** Samples over which a side road's end eases to the height of the road it meets. */
const EASE = 12;
const CELL_M = 16;

export function sideRoads(route: Route, others: readonly Route[]): Route[] {
	const kept = new Map<string, number[]>();
	const keep = (x: number, z: number, h: number) => {
		const k = `${Math.floor(x / CELL_M)}:${Math.floor(z / CELL_M)}`;
		const cell = kept.get(k);
		if (cell) cell.push(x, z, h);
		else kept.set(k, [x, z, h]);
	};
	const near = (x: number, z: number, within = CLEAR_M) => {
		const ci = Math.floor(x / CELL_M);
		const cj = Math.floor(z / CELL_M);
		for (let i = ci - 1; i <= ci + 1; i++)
			for (let j = cj - 1; j <= cj + 1; j++) {
				const cell = kept.get(`${i}:${j}`);
				if (!cell) continue;
				for (let k = 0; k < cell.length; k += 3)
					if (Math.hypot(cell[k] - x, cell[k + 1] - z) < within) return true;
			}
		return false;
	};
	/** The height of the road kept nearest (x, z), within reach of a junction; null where none is. */
	const heightAt = (x: number, z: number): number | null => {
		const ci = Math.floor(x / CELL_M);
		const cj = Math.floor(z / CELL_M);
		let best = CLEAR_M;
		let h: number | null = null;
		for (let i = ci - 1; i <= ci + 1; i++)
			for (let j = cj - 1; j <= cj + 1; j++) {
				const cell = kept.get(`${i}:${j}`);
				if (!cell) continue;
				for (let k = 0; k < cell.length; k += 3) {
					const d = Math.hypot(cell[k] - x, cell[k + 1] - z);
					if (d < best) {
						best = d;
						h = cell[k + 2];
					}
				}
			}
		return h;
	};
	/** A line's points every few metres, between its samples too. */
	const along = (r: Route, from: number, to: number, f: typeof keep) => {
		for (let i = from; i < to; i++)
			for (let t = 0; t < 1; t += 0.34)
				f(
					r.x[i] + (r.x[i + 1] - r.x[i]) * t,
					r.z[i] + (r.z[i + 1] - r.z[i]) * t,
					r.ele[i] + (r.ele[i + 1] - r.ele[i]) * t,
				);
		f(r.x[to], r.z[to], r.ele[to]);
	};
	along(route, 0, route.x.length - 1, keep);
	const out: Route[] = [];
	for (const other of others) {
		const n = other.x.length;
		const runs: [number, number][] = [];
		let from = -1;
		for (let i = 0; i <= n; i++) {
			const free = i < n && !near(other.x[i], other.z[i]);
			if (free && from < 0) from = i;
			if (!free && from >= 0) {
				// Back along its own line until it lies on the road it leaves, and on until it lies on the one it joins: at a junction the roads meet in one place, none stopping short of it.
				let a = from;
				for (
					let back = 0;
					a > 0 && back < REACH && !near(other.x[a], other.z[a], ON_M);
					back++
				)
					a--;
				let b = i - 1;
				for (
					let on = 0;
					b < n - 1 && on < REACH && !near(other.x[b], other.z[b], ON_M);
					on++
				)
					b++;
				if ((b - a) * other.step >= MIN_M) runs.push([a, b]);
				from = -1;
			}
		}
		for (const [a, b] of runs) {
			// It meets a road at that road's height: two lines drawn apart agree to a metre or two, and the ground has one height at a spot. Each end eases to it over EASE samples.
			const ele = other.ele.slice(a, b + 1);
			const last = ele.length - 1;
			[0, last].forEach((end) => {
				const h = heightAt(other.x[a + end], other.z[a + end]);
				if (h === null) return;
				const by = h - ele[end];
				for (let k = 0; k <= Math.min(EASE, last); k++) {
					const t = 1 - k / EASE;
					ele[end === 0 ? k : last - k] += by * t * t * (3 - 2 * t);
				}
			});
			const side = {
				...other,
				x: other.x.slice(a, b + 1),
				z: other.z.slice(a, b + 1),
				ele,
				grade: other.grade.slice(a, b + 1),
				length: (b - a) * other.step,
				loop: false,
				// One height datum for everything drawn: the ridden road's.
				minEle: route.minEle,
				maxEle: route.maxEle,
				scene: route.scene,
				climbs: [],
			};
			out.push(side);
			along(side, 0, last, keep);
		}
	}
	return out;
}
