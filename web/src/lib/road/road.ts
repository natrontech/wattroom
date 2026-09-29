/**
 * The road as it is kept and sent (#3023, ADR-0063): heights and turns every
 * ~20 m (docs/SPEC.md "store every 20 m") — what anyone but a route's owner
 * may be given — packed to bytes and hashed, and the owner's own shape as a
 * polyline.
 */

export type Road = {
	/** Metres from first sample to last, to the centimetre. */
	length: number;
	/** Height at each sample in metres, to the centimetre. */
	heights: number[];
	/** Whole degrees the road turns from each sample to the next (profile.ts); one fewer than heights. */
	turns: number[];
};

/** Metres between a road's samples. */
export const roadStep = (road: Road): number =>
	road.length / (road.heights.length - 1);

const VERSION = 1;
const cm = (m: number) => Math.round(m * 100);

/**
 * Little-endian:
 *
 *     u8   version
 *     u32  samples
 *     u32  length, cm
 *     i32  first height, cm
 *     i16  × (samples − 1)  height change, cm
 *     i8   × (samples − 1)  turn, degrees
 *
 * The stored grade bound keeps a 20 m step inside ±4 m, so a change always
 * fits an i16.
 */
export function packRoad(road: Road): Uint8Array<ArrayBuffer> {
	const n = road.heights.length;
	const bytes = new Uint8Array(13 + 3 * (n - 1));
	const v = new DataView(bytes.buffer);
	v.setUint8(0, VERSION);
	v.setUint32(1, n, true);
	v.setUint32(5, cm(road.length), true);
	v.setInt32(9, cm(road.heights[0]), true);
	for (let i = 1; i < n; i++) {
		v.setInt16(
			13 + 2 * (i - 1),
			cm(road.heights[i]) - cm(road.heights[i - 1]),
			true,
		);
		v.setInt8(13 + 2 * (n - 1) + (i - 1), road.turns[i - 1]);
	}
	return bytes;
}

export function unpackRoad(bytes: Uint8Array): Road {
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (v.getUint8(0) !== VERSION) throw new Error('unknown road version');
	const n = v.getUint32(1, true);
	const heights = [v.getInt32(9, true)];
	const turns: number[] = [];
	for (let i = 1; i < n; i++) {
		heights.push(heights[i - 1] + v.getInt16(13 + 2 * (i - 1), true));
		turns.push(v.getInt8(13 + 2 * (n - 1) + (i - 1)));
	}
	return {
		length: v.getUint32(5, true) / 100,
		heights: heights.map((h) => h / 100),
		turns,
	};
}

/** The road's identity: SHA-256 of its packed bytes, in hex. */
export async function roadHash(road: Road): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', packRoad(road));
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, '0'),
	).join('');
}

/**
 * The owner's shape as polyline6 — Google's encoded polyline at 1e-6 degrees:
 * zigzag delta varints in printable characters. The server seals it as it
 * comes (ADR-0063); it is never shown to anyone else.
 */
export function encodePolyline6(
	points: { lat: number; lon: number }[],
): string {
	let out = '';
	let lat = 0;
	let lon = 0;
	const put = (delta: number) => {
		let v = delta < 0 ? ~(delta << 1) : delta << 1;
		while (v >= 0x20) {
			out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
			v >>= 5;
		}
		out += String.fromCharCode(v + 63);
	};
	for (const p of points) {
		const a = Math.round(p.lat * 1e6);
		const b = Math.round(p.lon * 1e6);
		put(a - lat);
		put(b - lon);
		lat = a;
		lon = b;
	}
	return out;
}

export function decodePolyline6(s: string): { lat: number; lon: number }[] {
	const out: { lat: number; lon: number }[] = [];
	let i = 0;
	const take = () => {
		let v = 0;
		let shift = 0;
		let c: number;
		do {
			c = s.charCodeAt(i++) - 63;
			v |= (c & 0x1f) << shift;
			shift += 5;
		} while (c >= 0x20);
		return v & 1 ? ~(v >> 1) : v >> 1;
	};
	let lat = 0;
	let lon = 0;
	while (i < s.length) {
		lat += take();
		lon += take();
		out.push({ lat: lat / 1e6, lon: lon / 1e6 });
	}
	return out;
}
