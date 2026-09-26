// Set dressing: what stands beside the road. Every placement asks two
// questions first — is it clear of the road and of the camera's sightline
// (more room on the inside of bends), and does it belong where it stands
// (forest in the forest band, villages on low flat stretches, huts above
// the treeline, cows on meadows).
import { Biome } from './biome';
import { clearOf, type Field, type Nearest } from './field';
import { VILLAGES } from './names';
import { frameAt, type Route } from './route';

export type Props = {
	trees: Float32Array; // x, y, z, scale, kind (0 spruce, 1 broadleaf) ×N
	houses: Float32Array; // x, y, z, rotY, kind (0 house, 1 church, 2 barn, 3 hut) ×N
	cows: Float32Array; // x, y, z, rotY ×N
	rocks: Float32Array; // x, y, z, scale ×N
	villageNames: { d: number; name: string }[];
};

export type Ground = {
	rand: () => number;
	field: Field;
	nearest: Nearest;
	heightAt: (x: number, z: number) => number;
	biomeAt: (x: number, z: number) => Biome;
};

type Ctx = Ground & {
	roadDistAt: (x: number, z: number) => number; // coarse, ±20 m — a cheap first cut
	bounds: [number, number, number, number];
};

export function dress(route: Route, c: Ctx): Props {
	const { rand, field, nearest, heightAt, biomeAt, roadDistAt } = c;
	const [minX, minZ, maxX, maxZ] = c.bounds;
	const clear = (x: number, z: number, base: number) =>
		clearOf(field, nearest, x, z, base);
	const side = () => (rand() < 0.5 ? -1 : 1);

	// Villages first, so the forest can keep out of them.
	const houses: number[] = [];
	const villageNames: { d: number; name: string }[] = [];
	const span = Math.max(200, route.maxEle - route.minEle);
	const W = Math.round(500 / route.step);
	const names = [...VILLAGES];
	let lastVillage = -Infinity;
	const villageAt: [number, number][] = [];
	for (let i = W; i < route.x.length - W; i += Math.round(200 / route.step)) {
		const d = i * route.step;
		if (d - lastVillage < 4500) continue;
		let flat = true;
		for (let j = i - W; j <= i + W; j += 5)
			if (Math.abs(route.grade[j]) > 3) flat = false;
		if (!flat || route.ele[i] > route.minEle + span * 0.5) continue;
		lastVillage = d;
		villageAt.push([route.x[i], route.z[i]]);
		villageNames.push({
			d,
			name: names.splice(Math.floor(rand() * names.length), 1)[0] ?? 'Watt',
		});
		const placed: [number, number][] = [];
		const count = 12 + Math.floor(rand() * 10);
		for (let tries = 0, n = 0; tries < 200 && n < count; tries++) {
			const j = i + Math.round((rand() - 0.5) * 1.6 * W);
			const { lx, lz, heading } = frameAt(route, j);
			const s = side();
			const off = 15 + rand() * rand() * 90; // most houses close to the street
			const hx = route.x[j] + lx * off * s;
			const hz = route.z[j] + lz * off * s;
			if (!clear(hx, hz, 13) || biomeAt(hx, hz) === Biome.Water) continue;
			if (placed.some(([px, pz]) => (px - hx) ** 2 + (pz - hz) ** 2 < 15 ** 2))
				continue;
			placed.push([hx, hz]);
			const kind = n === 0 ? 1 : rand() < 0.15 ? 2 : 0;
			const face =
				heading + (s > 0 ? -Math.PI / 2 : Math.PI / 2) + (rand() - 0.5) * 0.25;
			houses.push(hx, heightAt(hx, hz), hz, face, kind);
			n++;
		}
	}
	// Barns on open meadow, alpine huts above the treeline — one every so often.
	for (let i = 0; i < route.x.length; i += Math.round(1300 / route.step)) {
		const { lx, lz, heading } = frameAt(route, i);
		const s = side();
		const off = 30 + rand() * 120;
		const hx = route.x[i] + lx * off * s;
		const hz = route.z[i] + lz * off * s;
		const b = biomeAt(hx, hz);
		if (!clear(hx, hz, 16)) continue;
		if (b === Biome.Meadow)
			houses.push(hx, heightAt(hx, hz), hz, heading + rand() * 0.6, 2);
		else if (b === Biome.Alpine)
			houses.push(hx, heightAt(hx, hz), hz, heading + rand() * 0.6, 3);
	}

	// Trees: jittered grid within 700 m of the road, dense in forest, thinning
	// at its edge, a few stragglers in meadows; never in a village.
	const trees: number[] = [];
	const T = 22;
	for (let z = minZ; z < maxZ; z += T)
		for (let x = minX; x < maxX; x += T) {
			const px = x + (rand() - 0.5) * T * 0.9;
			const pz = z + (rand() - 0.5) * T * 0.9;
			const b = biomeAt(px, pz);
			const p =
				b === Biome.Forest
					? 0.78
					: b === Biome.Meadow
						? 0.018
						: b === Biome.Alpine
							? 0.05
							: 0;
			if (rand() >= p) continue;
			const far = roadDistAt(px, pz);
			if (far > 700) continue;
			if (far < 140 && !clear(px, pz, 11)) continue;
			if (
				villageAt.some(([vx, vz]) => (vx - px) ** 2 + (vz - pz) ** 2 < 220 ** 2)
			)
				continue;
			const h = heightAt(px, pz);
			trees.push(
				px,
				h,
				pz,
				0.75 + rand() * 0.7,
				h < 900 && rand() < 0.55 ? 1 : 0,
			);
		}

	// Cows in small herds on meadows, never on the road's shoulder.
	const cows: number[] = [];
	for (let n = 0; n < 60 && cows.length < 4 * 160; n++) {
		const i = Math.floor(rand() * route.x.length);
		const { lx, lz } = frameAt(route, i);
		const s = side();
		const cx = route.x[i] + lx * (35 + rand() * 120) * s;
		const cz = route.z[i] + lz * (35 + rand() * 120) * s;
		if (biomeAt(cx, cz) !== Biome.Meadow && biomeAt(cx, cz) !== Biome.Alpine)
			continue;
		const herd = 3 + Math.floor(rand() * 5);
		for (let k = 0; k < herd; k++) {
			const hx = cx + (rand() - 0.5) * 30;
			const hz = cz + (rand() - 0.5) * 30;
			if (clear(hx, hz, 20))
				cows.push(hx, heightAt(hx, hz), hz, rand() * Math.PI * 2);
		}
	}

	// Rocks where the ground is rock or alpine, clustered.
	const rocks: number[] = [];
	for (let n = 0; n < 400 && rocks.length < 4 * 600; n++) {
		const i = Math.floor(rand() * route.x.length);
		const { lx, lz } = frameAt(route, i);
		const s = side();
		const rx = route.x[i] + lx * (14 + rand() * 250) * s;
		const rz = route.z[i] + lz * (14 + rand() * 250) * s;
		const b = biomeAt(rx, rz);
		if (b !== Biome.Rock && b !== Biome.Alpine) continue;
		for (let k = 0; k < 4; k++) {
			const x = rx + (rand() - 0.5) * 16;
			const z = rz + (rand() - 0.5) * 16;
			if (clear(x, z, 9)) rocks.push(x, heightAt(x, z), z, 0.6 + rand() * 1.6);
		}
	}

	return {
		trees: new Float32Array(trees),
		houses: new Float32Array(houses),
		cows: new Float32Array(cows),
		rocks: new Float32Array(rocks),
		villageNames,
	};
}
