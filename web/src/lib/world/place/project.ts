import { CHUNK_M } from './lattice';

/**
 * Place-keyed frames (#3224), for when the world is keyed by place (ADR-0081,
 * #3251): LV95 in Switzerland, UTM in the point's own zone elsewhere — never
 * a tile's local frame, so a place keys the same whichever tile or road
 * reached it. Double precision here; the scene draws in a float32 frame
 * around a chunk corner.
 *
 * The one file under place/ allowed trigonometry (place-lint.test.ts): a map
 * vertex is projected once, and the result is floored to centimetres before
 * it keys anything.
 * ponytail: Math.sin agrees between engines in practice, not by spec — an ulp
 * can move a coordinate across a centimetre about once in 10⁸ vertices. A
 * series in + and × alone, like the LV95 one, if a seam ever shows it.
 */

export type PlaceFrame =
	{ system: 'LV95' } | { system: 'UTM'; zone: number; south: boolean };

// ponytail: Switzerland is its bounding box, so a sliver of each neighbour
// keys by LV95 too; the border polygon when the geo pack (#3239) brings one.
const CH = { south: 45.8, north: 47.85, west: 5.95, east: 10.5 };

export function frameAt(lat: number, lon: number): PlaceFrame {
	if (lat >= CH.south && lat <= CH.north && lon >= CH.west && lon <= CH.east)
		return { system: 'LV95' };
	return {
		system: 'UTM',
		zone: Math.min(60, Math.floor((lon + 180) / 6) + 1),
		south: lat < 0,
	};
}

/**
 * swisstopo's approximate WGS84 → LV95 (about 1 m against the rigorous one):
 * a polynomial in the offsets from Bern, in 10,000s of arc-seconds.
 */
export function lv95(lat: number, lon: number): [number, number] {
	const p = (lat * 3600 - 169028.66) / 10000;
	const l = (lon * 3600 - 26782.5) / 10000;
	const e =
		2600072.37 +
		211455.93 * l -
		10938.51 * l * p -
		0.36 * l * p * p -
		44.54 * l * l * l;
	const n =
		1200147.07 +
		308807.95 * p +
		3745.25 * l * l +
		76.63 * p * p -
		194.56 * l * l * p +
		119.79 * p * p * p;
	return [e, n];
}

// WGS84, and UTM's scale and false origin.
const A_WGS = 6378137;
const F_WGS = 1 / 298.257223563;
const K0 = 0.9996;
const N_ = F_WGS / (2 - F_WGS);
const A_ = (A_WGS / (1 + N_)) * (1 + (N_ * N_) / 4 + (N_ * N_ * N_ * N_) / 64);
const ALPHA = [
	N_ / 2 - (2 * N_ * N_) / 3 + (5 * N_ * N_ * N_) / 16,
	(13 * N_ * N_) / 48 - (3 * N_ * N_ * N_) / 5,
	(61 * N_ * N_ * N_) / 240,
];
const ROOT = (2 * Math.sqrt(N_)) / (1 + N_);
const RAD = Math.PI / 180;

/** Krüger's series to n³, a few millimetres within 3,000 km of the zone's meridian. */
export function utm(
	lat: number,
	lon: number,
	zone: number,
	south: boolean,
): [number, number] {
	const phi = lat * RAD;
	const dl = (lon - (zone * 6 - 183)) * RAD;
	const s = Math.sin(phi);
	const t = Math.sinh(Math.atanh(s) - ROOT * Math.atanh(ROOT * s));
	const xi = Math.atan2(t, Math.cos(dl));
	const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
	let e = eta;
	let n = xi;
	for (let j = 1; j <= 3; j++) {
		e += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
		n += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
	}
	return [500000 + K0 * A_ * e, (south ? 10000000 : 0) + K0 * A_ * n];
}

export function project(
	frame: PlaceFrame,
	lat: number,
	lon: number,
): [number, number] {
	return frame.system === 'LV95'
		? lv95(lat, lon)
		: utm(lat, lon, frame.zone, frame.south);
}

/** The chunk corner a scene draws around, so its float32 coordinates stay small. */
export const originOf = (e: number, n: number): [number, number] => [
	Math.floor(e / CHUNK_M) * CHUNK_M,
	Math.floor(n / CHUNK_M) * CHUNK_M,
];

/** A projected point in the scene's float32 frame: x east, z south. */
export const localOf = (
	e: number,
	n: number,
	origin: [number, number],
): [number, number] => [Math.fround(e - origin[0]), Math.fround(origin[1] - n)];
