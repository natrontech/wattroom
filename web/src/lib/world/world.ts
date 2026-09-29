// A world is a pure function of the Route: same file → same seed → same
// valleys, forests and villages on every rider's screen. Nothing about the
// world is ever sent over the wire — only the route and each rider's
// distance along it.
//
// The only real data is the road's own line and height. Everything beside
// it is invented, but invented *from* it: roads run along valley floors,
// so the ground rises away from the road; forest sits in the altitude band
// forest sits in; villages sit where the road is low and flat; the highest
// point gets the summit arch.
import { type Biome } from './biome';
import { dress, type Props } from './dress';
import { FAR_W, makeField, roadIndex } from './field';
import { landUse } from './land';
import { markersFor, type Marker } from './markers';
import { hashSeed, prng } from './rand';
import type { Route } from './route';
import type { Names } from './names';
import { setPieces, type Arch, type Piece, type Sign } from './setpieces';
import { buildMesh, CH, type TerrainMesh } from './terrain-mesh';

export type World = {
	seed: number;
	nx: number;
	nz: number;
	x0: number;
	z0: number;
	cell: number;
	height: Float32Array; // coarse grid, metres above sea
	biome: Uint8Array;
	roadDist: Float32Array;
	water: number; // NaN when the world has no lake
	mesh: TerrainMesh; // fine beside the road, coarse far away, one crack-free surface
	heightAt: (x: number, z: number) => number; // the drawn surface, for anything that stands on it
	markers: Marker[];
	pieces: Piece[];
	signs: Sign[];
	arches: Arch[];
	names: Names;
} & Props;

const FINE_WITHIN = 170; // metres from the road a chunk must reach to get fine terrain

export function generate(route: Route, opts: { margin?: number } = {}): World {
	const seed = hashSeed(
		`${route.name}:${Math.round(route.length)}:${Math.round(route.gain)}`,
	);
	const rand = prng(seed);

	const margin = opts.margin ?? 1400;
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (let i = 0; i < route.x.length; i++) {
		minX = Math.min(minX, route.x[i]);
		maxX = Math.max(maxX, route.x[i]);
		minZ = Math.min(minZ, route.z[i]);
		maxZ = Math.max(maxZ, route.z[i]);
	}
	minX -= margin;
	maxX += margin;
	minZ -= margin;
	maxZ += margin;
	const cell = Math.max(
		40,
		Math.sqrt(((maxX - minX) * (maxZ - minZ)) / 140_000),
	);
	const ncx = Math.ceil((maxX - minX) / cell / CH);
	const ncz = Math.ceil((maxZ - minZ) / cell / CH);
	const nx = ncx * CH + 1;
	const nz = ncz * CH + 1;
	const N = nx * nz;
	const X = (ix: number) => minX + ix * cell;
	const Z = (iz: number) => minZ + iz * cell;

	// Coarse distance field by brute force on every 6th sample, refined ±6.
	// ponytail: O(verts × samples/6), ~150 ms at 50 km; a distance transform at 200 km.
	const C = 6;
	const roadDist = new Float32Array(N);
	const nearestIdx = new Int32Array(N);
	for (let k = 0; k < N; k++) {
		const x = X(k % nx);
		const z = Z(Math.floor(k / nx));
		let best = Infinity;
		let bi = 0;
		const closer = (i: number) => {
			const d = (route.x[i] - x) ** 2 + (route.z[i] - z) ** 2;
			if (d < best) {
				best = d;
				bi = i;
			}
		};
		for (let i = 0; i < route.x.length; i += C) closer(i);
		const hi = Math.min(route.x.length, bi + C + 1);
		for (let i = Math.max(0, bi - C); i < hi; i++) closer(i);
		roadDist[k] = Math.sqrt(best);
		nearestIdx[k] = bi;
	}
	// The far field: every 200 m of the route pulls every point, 1/d⁴ with a
	// 300 m core — one smooth surface, so a valley road and a summit road
	// 2 km apart meet in a hillside, not in a seam.
	const blurred = new Float32Array(N);
	const every = Math.max(1, Math.round(200 / route.step));
	for (let k = 0; k < N; k++) {
		const x = X(k % nx);
		const z = Z(Math.floor(k / nx));
		let se = 0;
		let sw = 0;
		for (let i = 0; i < route.x.length; i += every) {
			const q = (route.x[i] - x) ** 2 + (route.z[i] - z) ** 2 + 300 * 300;
			const w = 1 / (q * q); // 1/d⁴: near roads dominate, so this agrees with the local field where they meet
			se += route.ele[i] * w;
			sw += w;
		}
		blurred[k] = se / sw;
	}
	const bilinear = (a: Float32Array, x: number, z: number) => {
		const fx = Math.min(nx - 1.0001, Math.max(0, (x - minX) / cell));
		const fz = Math.min(nz - 1.0001, Math.max(0, (z - minZ) / cell));
		const ix = Math.floor(fx);
		const iz = Math.floor(fz);
		const tx = fx - ix;
		const tz = fz - iz;
		const k = iz * nx + ix;
		return (
			(a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) +
			(a[k + nx] * (1 - tx) + a[k + nx + 1] * tx) * tz
		);
	};
	// The coarse vertex nearest (x, z).
	const vertexAt = (x: number, z: number) =>
		Math.min(
			N - 1,
			Math.max(
				0,
				Math.round((z - minZ) / cell) * nx + Math.round((x - minX) / cell),
			),
		);
	const roads = roadIndex(route);
	const nearest = roads.nearest;
	const baseGrid = new Float32Array(N);
	for (let k = 0; k < N; k++) {
		const w = roads.weighted(X(k % nx), Z(Math.floor(k / nx)));
		baseGrid[k] = (w.ele * w.weight + blurred[k] * FAR_W) / (w.weight + FAR_W);
	}
	const field = makeField(
		route,
		seed,
		(x, z) => bilinear(baseGrid, x, z),
		roads.near,
	);

	// Coarse heights: the true field at every coarse vertex.
	const height = new Float32Array(N);
	for (let k = 0; k < N; k++) {
		const x = X(k % nx);
		const z = Z(Math.floor(k / nx));
		const hit = roadDist[k] < 400 ? nearest(x, z) : null; // 400 m: always inside the search rings (6 × 80 m)
		if (hit) roadDist[k] = hit.d;
		height[k] = field.height(
			x,
			z,
			roadDist[k],
			hit ? hit.ele : route.ele[nearestIdx[k]],
		);
	}

	// A lake where the ground sinks well below the road's lowest stretch.
	const floor = route.minEle - 25;
	let below = 0;
	for (let k = 0; k < N; k++)
		if (height[k] < floor && roadDist[k] > 60) below++;
	const water = below > N * 0.01 ? floor : NaN;
	const lake = (h: number, d: number) =>
		Number.isNaN(water) || d <= 25 ? h : Math.max(h, water - 18);
	for (let k = 0; k < N; k++) height[k] = lake(height[k], roadDist[k]);

	const land = landUse(field.noise.nDetail, water);
	const biome = new Uint8Array(N);
	const forest = new Float32Array(N);
	for (let iz = 0; iz < nz; iz++)
		for (let ix = 0; ix < nx; ix++) {
			const k = iz * nx + ix;
			const hx =
				height[Math.min(nx - 1, ix + 1) + iz * nx] -
				height[Math.max(0, ix - 1) + iz * nx];
			const hz =
				height[ix + Math.min(nz - 1, iz + 1) * nx] -
				height[ix + Math.max(0, iz - 1) * nx];
			const cover = land(
				X(ix),
				Z(iz),
				height[k],
				hx / (2 * cell),
				hz / (2 * cell),
				roadDist[k],
			);
			biome[k] = cover.biome;
			forest[k] = cover.forest;
		}

	// Which chunks get fine terrain: any whose corners come near the road.
	const fine = new Uint8Array(ncx * ncz);
	for (let cz = 0; cz < ncz; cz++)
		for (let cx = 0; cx < ncx; cx++) {
			let m = Infinity;
			for (let j = 0; j <= CH; j++)
				for (let i = 0; i <= CH; i++)
					m = Math.min(m, roadDist[(cz * CH + j) * nx + cx * CH + i]);
			if (m < FINE_WITHIN) fine[cz * ncx + cx] = 1;
		}

	const { mesh, heightAt } = buildMesh(
		{
			nx,
			nz,
			x0: minX,
			z0: minZ,
			cell,
			height,
			roadDist,
			biome,
			forest,
			fine: (cx, cz) =>
				cx >= 0 && cz >= 0 && cx < ncx && cz < ncz && fine[cz * ncx + cx] === 1,
		},
		(x, z, coarseD) => {
			const hit = nearest(x, z);
			if (hit)
				return { h: lake(field.height(x, z, hit.d, hit.ele), hit.d), d: hit.d };
			// Past the index's reach — a long route's wide chunks: the road as the
			// coarse pass saw it, so this vertex agrees with the coarse ground around it.
			const ele = route.ele[nearestIdx[vertexAt(x, z)]];
			return { h: lake(field.height(x, z, coarseD, ele), coarseD), d: coarseD };
		},
		land,
	);

	const biomeAt = (x: number, z: number) => biome[vertexAt(x, z)] as Biome;
	const props = dress(route, {
		rand,
		field,
		nearest,
		heightAt,
		biomeAt,
		roadDistAt: (x, z) => bilinear(roadDist, x, z),
		bounds: [minX, minZ, maxX, maxZ],
	});
	const markers = markersFor(route, props.villageNames);
	const set = setPieces(route, markers, {
		rand,
		field,
		nearest,
		heightAt,
		biomeAt,
		villages: props.villageNames,
	});
	return {
		seed,
		nx,
		nz,
		x0: minX,
		z0: minZ,
		cell,
		height,
		biome,
		roadDist,
		water,
		mesh,
		heightAt,
		...props,
		markers,
		...set,
	};
}
