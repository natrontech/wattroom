import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import type { Route } from '#lib/road/route.ts';
import { DESIGNS } from './designs';
import { road } from './geometry';
import { routeOfRoad } from './road-route';
import { liftOf } from './road-surface';
import { FORMATION, ROAD_W, SHOULDER } from './terrain/road-profile';
import { generate } from './world';
import { BUILD_MS } from './world.test-helper';

/**
 * A junction is one surface (side-roads.ts, road-surface.ts): where a side
 * road runs into a road, the two ribbons cover every spot of either's
 * formation, and where one gives way to the other they lie at one height.
 * A step between them is a slit the eye sees under a ribbon through, to
 * the ground: the green and brown slivers at the mouths, which shimmered
 * as the eye moved. Read straight down through the ribbons as drawn, each
 * fragment kept or discarded as the road's paint keeps it.
 */

const W = ROAD_W / 2;

/**
 * Whether the road's paint draws a fragment `u` metres across its own road,
 * at `bare` (crossings.ts meetingAt, interpolated): geometry.ts
 * roadMaterial's discards, the same three rules.
 */
function drawn(u: number, bare: [number, number]): boolean {
	const [signed, as] = bare;
	const o = Math.abs(signed);
	const joins = as >= 0.5;
	const joined = -as >= 0.5;
	const seated = as >= 1.5;
	if (joins && (seated ? signed : o) < W - 0.1) return false;
	if (joins && !seated && Math.abs(u) > W && o < FORMATION) return false;
	if (joined && Math.abs(u) > W && o < W - 0.15) return false;
	return true;
}

/** Metres from (x, z) to a line. */
function off(l: Route, x: number, z: number) {
	let best = Infinity;
	for (let i = 0; i + 1 < l.x.length; i++) {
		const sx = l.x[i + 1] - l.x[i];
		const sz = l.z[i + 1] - l.z[i];
		const px = x - l.x[i];
		const pz = z - l.z[i];
		const t = Math.min(
			1,
			Math.max(0, (px * sx + pz * sz) / (sx * sx + sz * sz || 1)),
		);
		best = Math.min(best, Math.hypot(px - sx * t, pz - sz * t));
	}
	return best;
}

describe('a junction’s surface', () => {
	it.each(DESIGNS.filter((d) => d.others).map((d) => [d.id] as const))(
		'%s: every mouth is one surface, with no slit between the two roads and no hole in either',
		async (id) => {
			const home = await homeRoute(HOME_ROADS.find((h) => h.id === id)!);
			const route = routeOfRoad(home.road);
			const world = generate(route);
			const roads = [
				{ of: world.ridden, lift: liftOf(route, true), caps: undefined },
				...world.sides.map((s) => ({
					of: s.route,
					lift: liftOf(s.route, false),
					caps: s.square
						? ([false, false] as const)
						: ([!s.mouths[0], !s.mouths[1]] as const),
				})),
			];
			const ray = new THREE.Raycaster();
			const down = new THREE.Vector3(0, -1, 0);
			const bad: string[] = [];
			let mouths = 0;
			world.sides.forEach((side, k) =>
				side.mouths.forEach((m, end) => {
					if (!m) return;
					mouths++;
					const where = `${id}, side road ${k}, end ${end}`;
					// A square 20 m across on the junction: from the side road's mouth to past the road met's centre.
					const cx = m.x + m.tx * m.d;
					const cz = m.z + m.tz * m.d;
					// Every ribbon there, as the stage draws them: 30 m either way of each road's nearest point, roundabouts' rings and arms among them.
					const pieces = roads
						.flatMap((r, j) => {
							let best = 30;
							let near = -1;
							for (let i = 0; i < r.of.x.length; i++) {
								const d = Math.hypot(r.of.x[i] - cx, r.of.z[i] - cz);
								if (d < best) {
									best = d;
									near = i;
								}
							}
							if (near < 0) return [];
							const k = Math.round((near * r.of.step) / 2);
							return [{ j, rows: [k - 15, k + 15] }];
						})
						.map(({ j, rows }) => {
							const r = roads[j];
							const mesh = new THREE.Mesh(
								road(r.of, {
									width: ROAD_W,
									shoulder: SHOULDER,
									rows: [
										r.of.loop ? rows[0] : Math.max(0, rows[0]),
										rows[1],
									] as const,
									lift: r.lift,
									caps: r.caps,
								}),
								new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
							);
							mesh.name = String(j);
							mesh.updateMatrixWorld();
							return { mesh, line: r.of };
						});
					const meshes = pieces.map((p) => p.mesh);
					// Every fragment kept straight down through (x, z), highest first.
					const at = (x: number, z: number) => {
						ray.set(new THREE.Vector3(x, 1e5, z), down);
						return ray.intersectObjects(meshes, false).flatMap((h) => {
							const g = (h.object as THREE.Mesh).geometry;
							const f = h.face!;
							const p = g.getAttribute('position');
							const bc = THREE.Triangle.getBarycoord(
								h.point,
								new THREE.Vector3().fromBufferAttribute(p, f.a),
								new THREE.Vector3().fromBufferAttribute(p, f.b),
								new THREE.Vector3().fromBufferAttribute(p, f.c),
								new THREE.Vector3(),
							)!;
							const lerp = (name: string, c: number) => {
								const a = g.getAttribute(name);
								return (
									a.getComponent(f.a, c) * bc.x +
									a.getComponent(f.b, c) * bc.y +
									a.getComponent(f.c, c) * bc.z
								);
							};
							return drawn(lerp('uv', 0), [lerp('bare', 0), lerp('bare', 1)])
								? [{ y: h.point.y, road: h.object.name }]
								: [];
						});
					};
					const STEP = 0.5;
					const N = 20 / STEP;
					// A side road running on from a roundabout's arm, end to end, stops short of it yet: the roundabout's own to close (designed.ts).
					const ontoRoundabout = m.met > 0 && !!world.sides[m.met - 1].square;
					let holes = 0;
					const grid = Array.from({ length: N + 1 }, (_, i) =>
						Array.from({ length: N + 1 }, (_, j) => {
							const x = cx - 10 + i * STEP;
							const z = cz - 10 + j * STEP;
							const kept = at(x, z);
							if (
								kept.length === 0 &&
								pieces.some((p) => off(p.line, x, z) < FORMATION - 0.3)
							)
								holes++;
							return kept;
						}),
					);
					if (holes > 0 && !ontoRoundabout)
						bad.push(`${where}: ${holes * STEP * STEP} m² of it not drawn`);
					// Where the highest surface changes from one road to the other and neither runs on under the other, the two meet at one height.
					let worst = 0;
					for (let i = 0; i <= N; i++)
						for (let j = 0; j <= N; j++)
							for (const [a, b] of [
								[i + 1, j],
								[i, j + 1],
							]) {
								if (a > N || b > N) continue;
								const p = grid[i][j];
								const q = grid[a][b];
								if (!p.length || !q.length || p[0].road === q[0].road) continue;
								if (
									p.some((s) => s.road === q[0].road) ||
									q.some((s) => s.road === p[0].road)
								)
									continue;
								// Where it changes, to a few millimetres: a shoulder falls 12 cm in half a metre.
								let [lo, hi] = [0, 1];
								const top = (t: number) =>
									at(
										cx - 10 + (i + (a - i) * t) * STEP,
										cz - 10 + (j + (b - j) * t) * STEP,
									)[0];
								for (let n = 0; n < 8; n++) {
									const mid = (lo + hi) / 2;
									if (top(mid)?.road === p[0].road) lo = mid;
									else hi = mid;
								}
								const [u, v] = [top(lo), top(hi)];
								if (u && v) worst = Math.max(worst, Math.abs(u.y - v.y));
							}
					if (worst > 0.03)
						bad.push(
							`${where}: a step of ${worst.toFixed(2)} m between the roads`,
						);
				}),
			);
			expect(mouths).toBeGreaterThan(5);
			expect(bad).toEqual([]);
		},
		3 * BUILD_MS,
	);
});
