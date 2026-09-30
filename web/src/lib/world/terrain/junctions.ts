import { smoothstep } from '../rand';
import { indexLines, type Line } from './lines';

/**
 * Where one road ends on another, the two surfaces meet at one height
 * (#3075): each takes half the difference, faded along its own line over
 * PATCH_M. Only a line's end makes a junction, and the fade runs along the
 * line, never across — so a road that merely passes above another, a
 * stacked switchback or a bridge, is left where it is. The lab's 0.71 m
 * junction step came from two heights for one spot.
 */

/** An end this close to another line meets it. */
const TOUCH_M = 5;
/**
 * The fade's length. A step of s split in half moves each road by s/2 over
 * this, so its grade changes by at most 0.75 s / PATCH_M: 1 % for the lab's
 * step, gentler than any road that climbs, so the patch never reverses one.
 */
export const PATCH_M = 50;

export function patchJunctions(lines: Line[]): Line[] {
	if (lines.length < 2) return lines;
	const index = indexLines(lines);
	const arc = lines.map((l) => {
		const s = new Float64Array(l.x.length);
		for (let i = 1; i < s.length; i++)
			s[i] =
				s[i - 1] +
				Math.sqrt((l.x[i] - l.x[i - 1]) ** 2 + (l.z[i] - l.z[i - 1]) ** 2);
		return s;
	});
	const offset = lines.map((l) => new Float64Array(l.x.length));
	const fadeFrom = (k: number, at: number, by: number) => {
		for (let i = 0; i < arc[k].length; i++) {
			const d = Math.abs(arc[k][i] - at);
			if (d < PATCH_M) offset[k][i] += by * (1 - smoothstep(0, PATCH_M, d));
		}
	};
	const endsNear = (m: number, x: number, z: number) => {
		const l = lines[m];
		const n = l.x.length - 1;
		return [0, n].some(
			(i) => (l.x[i] - x) ** 2 + (l.z[i] - z) ** 2 <= TOUCH_M * TOUCH_M,
		);
	};
	lines.forEach((l, k) => {
		for (const end of [0, l.x.length - 1]) {
			const hit = index.nearest(l.x[end], l.z[end], 1, k);
			if (!hit || hit.d > TOUCH_M) continue;
			const m = index.lineOf[hit.i];
			// Two ends on one spot are one junction: the lower-numbered line settles it.
			if (m < k && endsNear(m, l.x[end], l.z[end])) continue;
			const step = hit.h - l.h[end];
			fadeFrom(k, arc[k][end], step / 2);
			const i = hit.i - index.starts[m];
			fadeFrom(m, arc[m][i] + (arc[m][i + 1] - arc[m][i]) * hit.t, -step / 2);
		}
	});
	return lines.map((l, k) =>
		offset[k].some((o) => o !== 0)
			? { ...l, h: Float64Array.from(l.h, (v, i) => v + offset[k][i]) }
			: l,
	);
}
